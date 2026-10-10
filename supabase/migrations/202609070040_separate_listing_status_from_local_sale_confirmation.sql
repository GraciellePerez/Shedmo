-- Keep listing availability separate from buyer-confirmed local transaction history.
-- Existing rows, statuses, confirmation records, and review relationships are preserved.

create or replace function public.guard_direct_local_listing_status_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- pending_local_confirmation is retained only for backward compatibility.
  if (new.status = 'pending_local_confirmation' or old.status = 'pending_local_confirmation')
    and coalesce(current_setting('app.direct_local_sale_transition', true), '') <> 'allowed' then
    raise exception using errcode = '42501', message = 'Direct local sale state requires the trusted confirmation workflow.';
  end if;
  return new;
end;
$$;

create or replace function public.start_direct_local_sale_v1(
  p_listing_id uuid,
  p_conversation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_conversation public.conversations%rowtype;
  v_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or v_listing.seller_id <> v_actor then
    raise exception using errcode = '42501', message = 'Listing unavailable.';
  end if;
  if v_listing.status <> 'active' or not v_listing.pickup_available then
    raise exception using errcode = '55000', message = 'Listing is not eligible for a direct local sale.';
  end if;
  select * into v_conversation
  from public.conversations
  where id = p_conversation_id and listing_id = p_listing_id and seller_id = v_actor;
  if not found or v_conversation.buyer_id = v_actor
    or not exists (select 1 from public.messages where conversation_id = p_conversation_id) then
    raise exception using errcode = '42501', message = 'Buyer must be associated through a listing conversation.';
  end if;
  if exists (
    select 1 from public.orders where listing_id = p_listing_id
      and (payment_status in ('processing','succeeded','refunding','refunded')
        or fulfillment_status not in ('canceled','expired'))
  ) then
    raise exception using errcode = '55000', message = 'An existing transaction conflicts with this listing.';
  end if;

  update public.listings set status = 'sold', updated_at = now() where id = p_listing_id;
  insert into public.local_sale_confirmations(
    listing_id, conversation_id, seller_id, buyer_id, status,
    listing_title_snapshot, listing_price_snapshot, seller_confirmed_at
  ) values (
    p_listing_id, p_conversation_id, v_actor, v_conversation.buyer_id,
    'pending_buyer_confirmation', v_listing.title, v_listing.price, now()
  ) returning id into v_id;
  insert into public.notifications(user_id, actor_id, type, title, body, listing_id, conversation_id)
  values (
    v_conversation.buyer_id, v_actor, 'local_sale_confirmation', 'Confirm purchase',
    'Did you purchase ' || v_listing.title || '? Shedmo does not process or verify payment.',
    p_listing_id, p_conversation_id
  );
  insert into public.marketplace_analytics_events(user_id, event_name, entity_type, entity_id, safe_metadata)
  values (
    v_actor, 'local_direct_sale_started', 'local_sale', v_id,
    jsonb_build_object('price_bucket', case when v_listing.price < 50 then 'under_50' when v_listing.price < 200 then '50_199' else '200_plus' end)
  );
  return v_id;
end;
$$;

create or replace function public.respond_direct_local_sale_v1(
  p_confirmation_id uuid,
  p_confirm boolean
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_sale public.local_sale_confirmations%rowtype;
begin
  select * into v_sale from public.local_sale_confirmations where id = p_confirmation_id for update;
  if not found or v_sale.buyer_id <> v_actor then
    raise exception using errcode = '42501', message = 'Confirmation unavailable.';
  end if;
  if v_sale.status = 'confirmed' and p_confirm then return 'confirmed'; end if;
  if v_sale.status = 'rejected' and not p_confirm then return 'rejected'; end if;
  if v_sale.status <> 'pending_buyer_confirmation' then
    raise exception using errcode = '55000', message = 'Confirmation is no longer pending.';
  end if;

  if p_confirm then
    update public.local_sale_confirmations
      set status = 'confirmed', buyer_confirmed_at = now(), updated_at = now()
      where id = v_sale.id;
    insert into public.notifications(user_id, actor_id, type, title, body, listing_id, conversation_id)
    values (
      v_sale.seller_id, v_actor, 'local_sale_confirmation', 'Local sale confirmed',
      v_sale.listing_title_snapshot || ' was confirmed by the buyer. Reviews are now available.',
      v_sale.listing_id, v_sale.conversation_id
    );
    insert into public.marketplace_analytics_events(user_id, event_name, entity_type, entity_id, safe_metadata)
    values (v_actor, 'local_direct_sale_confirmed', 'local_sale', v_sale.id, '{}');
    return 'confirmed';
  end if;

  update public.local_sale_confirmations
    set status = 'rejected', rejected_at = now(), updated_at = now()
    where id = v_sale.id;
  insert into public.marketplace_analytics_events(user_id, event_name, entity_type, entity_id, safe_metadata)
  values (v_actor, 'local_direct_sale_rejected', 'local_sale', v_sale.id, '{}');
  return 'rejected';
end;
$$;

create or replace function public.cancel_direct_local_sale_v1(p_confirmation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_sale public.local_sale_confirmations%rowtype;
begin
  select * into v_sale from public.local_sale_confirmations where id = p_confirmation_id for update;
  if not found or v_sale.seller_id <> v_actor then
    raise exception using errcode = '42501', message = 'Confirmation unavailable.';
  end if;
  if v_sale.status <> 'pending_buyer_confirmation' then
    raise exception using errcode = '55000', message = 'Only pending confirmations may be cancelled.';
  end if;
  perform 1 from public.listings where id = v_sale.listing_id for update;
  update public.local_sale_confirmations
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = v_sale.id;
  update public.listings set status = 'active', updated_at = now()
    where id = v_sale.listing_id and status = 'sold'
      and not exists (
        select 1 from public.orders where listing_id = v_sale.listing_id
          and payment_status in ('processing','succeeded','refunding','refunded')
      );
end;
$$;

create or replace function public.mark_local_listing_disposition_v2(
  p_listing_id uuid,
  p_disposition text
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_status text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_disposition not in ('sold_elsewhere', 'unavailable') then
    raise exception using errcode = '22023', message = 'Unsupported listing disposition.';
  end if;
  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or v_listing.seller_id <> v_actor then
    raise exception using errcode = '42501', message = 'Listing unavailable.';
  end if;
  if v_listing.status <> 'active' then
    raise exception using errcode = '55000', message = 'Only active listings can be updated.';
  end if;
  v_status := case when p_disposition = 'sold_elsewhere' then 'sold' else 'archived' end;
  update public.listings set status = v_status, updated_at = now() where id = p_listing_id;
  return v_status;
end;
$$;

create or replace function public.get_public_seller_profile_v2(p_seller_id uuid)
returns table (
  seller_id uuid, display_name text, username text, avatar_url text, bio text,
  city text, state text, member_since timestamptz, active_listing_count bigint,
  sold_listing_count bigint, verified_sales_count bigint, average_rating numeric, total_reviews bigint
)
language sql security definer set search_path = '' stable as $$
  select p.id, p.display_name, p.username, p.avatar_url, p.bio, p.city, p.state, p.created_at,
    (select count(*) from public.listings l where l.seller_id = p.id and l.status = 'active'),
    (select count(*) from public.listings l where l.seller_id = p.id and l.status = 'sold'),
    (select count(*) from public.orders o where o.seller_id = p.id and o.fulfillment_status = 'completed' and o.completed_at is not null)
      + (select count(*) from public.local_sale_confirmations s where s.seller_id = p.id and s.status = 'confirmed'),
    (select round(avg(r.rating)::numeric, 2) from public.marketplace_reviews r where r.reviewee_id = p.id and r.direction = 'buyer_to_seller'),
    (select count(*) from public.marketplace_reviews r where r.reviewee_id = p.id and r.direction = 'buyer_to_seller')
  from public.profiles p where p.id = p_seller_id;
$$;

revoke all on function public.mark_local_listing_disposition_v2(uuid, text) from public, anon;
grant execute on function public.mark_local_listing_disposition_v2(uuid, text) to authenticated;

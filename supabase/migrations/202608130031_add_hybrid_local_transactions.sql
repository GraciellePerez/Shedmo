-- Hybrid local transactions: optional mutually-confirmed direct pickup sales.
-- This migration is intentionally undeployed; protected checkout remains unchanged.

alter table public.listings drop constraint listings_status_check;
alter table public.listings add constraint listings_status_check
  check (status in ('draft','active','reserved','pending_local_confirmation','sold','expired','archived'));

create table public.local_sale_confirmations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  status text not null check (status in ('pending_buyer_confirmation','confirmed','rejected','cancelled')),
  listing_title_snapshot text not null,
  listing_price_snapshot numeric(12,2) not null check (listing_price_snapshot >= 0),
  seller_confirmed_at timestamptz not null,
  buyer_confirmed_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint local_sale_parties_differ check (seller_id <> buyer_id),
  constraint local_sale_conversation_unique unique (conversation_id, listing_id)
);
create unique index local_sale_one_live_per_listing
  on public.local_sale_confirmations(listing_id)
  where status in ('pending_buyer_confirmation','confirmed');
create index local_sale_buyer_status_idx on public.local_sale_confirmations(buyer_id,status,created_at desc);
create index local_sale_seller_status_idx on public.local_sale_confirmations(seller_id,status,created_at desc);

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in('new_message','listing_favorited','local_sale_confirmation'));
alter table public.notifications drop constraint notifications_target_check;
alter table public.notifications add constraint notifications_target_check check(
  (type='new_message' and conversation_id is not null and listing_id is not null) or
  (type='listing_favorited' and listing_id is not null) or
  (type='local_sale_confirmation' and conversation_id is not null and listing_id is not null));

create function public.guard_direct_local_listing_status_v1() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.status='pending_local_confirmation' or old.status='pending_local_confirmation')
    and coalesce(current_setting('app.direct_local_sale_transition',true),'')<>'allowed' then
    raise exception using errcode='42501',message='Direct local sale state requires the trusted confirmation workflow.';
  end if;
  if old.status='active' and new.status='sold'
    and coalesce(current_setting('app.direct_local_sale_transition',true),'')<>'allowed' then
    raise exception using errcode='42501',message='A seller cannot create a verified sale without buyer confirmation.';
  end if;
  return new;
end;$$;
create trigger listings_guard_direct_local_status before update of status on public.listings
for each row execute function public.guard_direct_local_listing_status_v1();
revoke all on function public.guard_direct_local_listing_status_v1() from public,anon,authenticated;

alter table public.local_sale_confirmations enable row level security;
revoke all on table public.local_sale_confirmations from public,anon,authenticated;
grant select on table public.local_sale_confirmations to authenticated;
grant select on table public.local_sale_confirmations to service_role;
create policy local_sale_participants_read on public.local_sale_confirmations
  for select to authenticated using (auth.uid() in (buyer_id,seller_id));

create function public.get_direct_local_sale_buyers_v1(p_listing_id uuid)
returns table(conversation_id uuid,buyer_id uuid,buyer_name text,last_message_at timestamptz)
language sql security definer stable set search_path=''
as $$
  select c.id,c.buyer_id,
    coalesce(nullif(btrim(p.display_name),''),nullif(btrim(p.username),''),'Marketplace member'),
    c.last_message_at
  from public.listings l
  join public.conversations c on c.listing_id=l.id and c.seller_id=l.seller_id
  join public.profiles p on p.id=c.buyer_id
  where l.id=p_listing_id and l.seller_id=auth.uid() and l.pickup_available
    and exists(select 1 from public.messages m where m.conversation_id=c.id)
  order by c.last_message_at desc nulls last,c.created_at desc;
$$;

create function public.start_direct_local_sale_v1(p_listing_id uuid,p_conversation_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_actor uuid:=auth.uid();v_listing public.listings%rowtype;v_conversation public.conversations%rowtype;v_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication required.';end if;
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found or v_listing.seller_id<>v_actor then raise exception using errcode='42501',message='Listing unavailable.';end if;
  if v_listing.status<>'active' or not v_listing.pickup_available then raise exception using errcode='55000',message='Listing is not eligible for a direct local sale.';end if;
  select * into v_conversation from public.conversations where id=p_conversation_id and listing_id=p_listing_id and seller_id=v_actor;
  if not found or v_conversation.buyer_id=v_actor or not exists(select 1 from public.messages where conversation_id=p_conversation_id)
    then raise exception using errcode='42501',message='Buyer must be associated through a listing conversation.';end if;
  if exists(select 1 from public.orders where listing_id=p_listing_id and (payment_status in ('processing','succeeded','refunding','refunded') or fulfillment_status not in ('canceled','expired')))
    then raise exception using errcode='55000',message='A protected checkout already exists for this listing.';end if;
  perform set_config('app.direct_local_sale_transition','allowed',true);
  update public.listings set status='pending_local_confirmation',updated_at=now() where id=p_listing_id;
  insert into public.local_sale_confirmations(listing_id,conversation_id,seller_id,buyer_id,status,listing_title_snapshot,listing_price_snapshot,seller_confirmed_at)
  values(p_listing_id,p_conversation_id,v_actor,v_conversation.buyer_id,'pending_buyer_confirmation',v_listing.title,v_listing.price,now()) returning id into v_id;
  insert into public.notifications(user_id,actor_id,type,title,body,listing_id,conversation_id)
  values(v_conversation.buyer_id,v_actor,'local_sale_confirmation','Confirm your local purchase','Did you buy '||v_listing.title||' in person? Marketplace did not process this payment.',p_listing_id,p_conversation_id);
  insert into public.marketplace_analytics_events(user_id,event_name,entity_type,entity_id,safe_metadata)
  values(v_actor,'local_direct_sale_started','local_sale',v_id,jsonb_build_object('price_bucket',case when v_listing.price<50 then 'under_50' when v_listing.price<200 then '50_199' else '200_plus' end));
  return v_id;
end;$$;

create function public.respond_direct_local_sale_v1(p_confirmation_id uuid,p_confirm boolean)
returns text language plpgsql security definer set search_path=''
as $$
declare v_actor uuid:=auth.uid();v_sale public.local_sale_confirmations%rowtype;v_listing public.listings%rowtype;
begin
  select * into v_sale from public.local_sale_confirmations where id=p_confirmation_id for update;
  if not found or v_sale.buyer_id<>v_actor then raise exception using errcode='42501',message='Confirmation unavailable.';end if;
  if v_sale.status='confirmed' and p_confirm then return 'confirmed';end if;
  if v_sale.status<>'pending_buyer_confirmation' then raise exception using errcode='55000',message='Confirmation is no longer pending.';end if;
  select * into v_listing from public.listings where id=v_sale.listing_id for update;
  if v_listing.status<>'pending_local_confirmation' then raise exception using errcode='55000',message='Listing state changed.';end if;
  if exists(select 1 from public.orders where listing_id=v_sale.listing_id and payment_status in ('processing','succeeded','refunding','refunded'))
    then raise exception using errcode='55000',message='A protected checkout conflicts with this sale.';end if;
  perform set_config('app.direct_local_sale_transition','allowed',true);
  if p_confirm then
    update public.local_sale_confirmations set status='confirmed',buyer_confirmed_at=now(),updated_at=now() where id=v_sale.id;
    update public.listings set status='sold',updated_at=now() where id=v_sale.listing_id;
    insert into public.notifications(user_id,actor_id,type,title,body,listing_id,conversation_id)
    values(v_sale.seller_id,v_actor,'local_sale_confirmation','Local sale confirmed',v_sale.listing_title_snapshot||' was mutually confirmed. Reviews are now available.',v_sale.listing_id,v_sale.conversation_id);
    insert into public.marketplace_analytics_events(user_id,event_name,entity_type,entity_id,safe_metadata)
    values(v_actor,'local_direct_sale_confirmed','local_sale',v_sale.id,'{}');
    return 'confirmed';
  end if;
  update public.local_sale_confirmations set status='rejected',rejected_at=now(),updated_at=now() where id=v_sale.id;
  update public.listings set status='active',updated_at=now() where id=v_sale.listing_id and status='pending_local_confirmation';
  insert into public.marketplace_analytics_events(user_id,event_name,entity_type,entity_id,safe_metadata)
  values(v_actor,'local_direct_sale_rejected','local_sale',v_sale.id,'{}');
  return 'rejected';
end;$$;

create function public.cancel_direct_local_sale_v1(p_confirmation_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_actor uuid:=auth.uid();v_sale public.local_sale_confirmations%rowtype;
begin
  select * into v_sale from public.local_sale_confirmations where id=p_confirmation_id for update;
  if not found or v_sale.seller_id<>v_actor then raise exception using errcode='42501',message='Confirmation unavailable.';end if;
  if v_sale.status<>'pending_buyer_confirmation' then raise exception using errcode='55000',message='Only pending confirmations may be cancelled.';end if;
  perform 1 from public.listings where id=v_sale.listing_id for update;
  perform set_config('app.direct_local_sale_transition','allowed',true);
  update public.local_sale_confirmations set status='cancelled',cancelled_at=now(),updated_at=now() where id=v_sale.id;
  update public.listings set status='active',updated_at=now() where id=v_sale.listing_id and status='pending_local_confirmation'
    and not exists(select 1 from public.orders where listing_id=v_sale.listing_id and payment_status in ('processing','succeeded','refunding','refunded'));
end;$$;

alter table public.marketplace_reviews alter column order_id drop not null;
alter table public.marketplace_reviews add column local_sale_confirmation_id uuid references public.local_sale_confirmations(id) on delete restrict;
alter table public.marketplace_reviews add column source text not null default 'protected_checkout' check(source in ('protected_checkout','confirmed_local_sale'));
alter table public.marketplace_reviews add constraint marketplace_review_one_source check(
  (source='protected_checkout' and order_id is not null and local_sale_confirmation_id is null) or
  (source='confirmed_local_sale' and order_id is null and local_sale_confirmation_id is not null));
create unique index marketplace_reviews_local_party_uidx on public.marketplace_reviews(local_sale_confirmation_id,reviewer_id) where local_sale_confirmation_id is not null;
create unique index marketplace_reviews_local_direction_uidx on public.marketplace_reviews(local_sale_confirmation_id,direction) where local_sale_confirmation_id is not null;

create function public.get_local_sale_review_status_v1(p_confirmation_id uuid)
returns table(eligible boolean,reviewed boolean,direction text) language plpgsql security definer stable set search_path=''
as $$ declare v_actor uuid:=auth.uid();v_sale public.local_sale_confirmations%rowtype;
begin select * into v_sale from public.local_sale_confirmations where id=p_confirmation_id;
if not found or v_actor not in(v_sale.buyer_id,v_sale.seller_id) then raise exception using errcode='P0002',message='Transaction unavailable.';end if;
return query select v_sale.status='confirmed',exists(select 1 from public.marketplace_reviews r where r.local_sale_confirmation_id=v_sale.id and r.reviewer_id=v_actor),case when v_actor=v_sale.buyer_id then 'buyer_to_seller' else 'seller_to_buyer' end;end;$$;

create function public.submit_local_sale_review_v1(p_confirmation_id uuid,p_rating smallint,p_body text default null)
returns uuid language plpgsql security definer set search_path=''
as $$ declare v_actor uuid:=auth.uid();v_sale public.local_sale_confirmations%rowtype;v_id uuid;v_direction text;v_reviewee uuid;v_body text:=nullif(btrim(p_body),'');
begin if p_rating not between 1 and 5 or (v_body is not null and char_length(v_body)>800) then raise exception using errcode='22023',message='Invalid review.';end if;
select * into v_sale from public.local_sale_confirmations where id=p_confirmation_id;
if not found or v_sale.status<>'confirmed' then raise exception using errcode='55000',message='Reviews require a mutually confirmed local sale.';end if;
if v_actor=v_sale.buyer_id then v_direction:='buyer_to_seller';v_reviewee:=v_sale.seller_id;elsif v_actor=v_sale.seller_id then v_direction:='seller_to_buyer';v_reviewee:=v_sale.buyer_id;else raise exception using errcode='42501',message='Transaction unavailable.';end if;
insert into public.marketplace_reviews(order_id,local_sale_confirmation_id,source,reviewer_id,reviewee_id,direction,rating,body)
values(null,v_sale.id,'confirmed_local_sale',v_actor,v_reviewee,v_direction,p_rating,v_body) returning id into v_id;return v_id;
exception when unique_violation then raise exception using errcode='23505',message='This transaction has already been reviewed.';end;$$;

alter table public.marketplace_analytics_events drop constraint marketplace_analytics_events_event_name_check;
alter table public.marketplace_analytics_events add constraint marketplace_analytics_events_event_name_check check(event_name in(
  'signup_completed','login_completed','listing_created','listing_viewed','listing_saved','listing_shared','listing_reported','search_performed','filter_applied','conversation_started','message_sent','stripe_onboarding_started','stripe_onboarding_completed','checkout_started','checkout_payment_sheet_opened','checkout_succeeded','checkout_failed','pickup_ready','pickup_confirmed','shipment_recorded','delivery_confirmed','inspection_completed','review_submitted','dispute_opened','local_direct_sale_started','local_direct_sale_confirmed','local_direct_sale_rejected','protected_checkout_selected','protected_checkout_completed'));

create or replace function public.record_marketplace_analytics_event_v1(p_event_name text,p_entity_type text default null,p_entity_id uuid default null,p_metadata jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_safe jsonb;
begin
if auth.role()<>'authenticated' or v_actor is null then raise exception using errcode='42501',message='Authentication required.';end if;
if p_event_name not in('signup_completed','login_completed','listing_created','listing_viewed','listing_saved','listing_shared','listing_reported','search_performed','filter_applied','conversation_started','message_sent','stripe_onboarding_started','stripe_onboarding_completed','checkout_started','checkout_payment_sheet_opened','checkout_succeeded','checkout_failed','pickup_ready','pickup_confirmed','shipment_recorded','delivery_confirmed','inspection_completed','review_submitted','dispute_opened','local_direct_sale_started','local_direct_sale_confirmed','local_direct_sale_rejected','protected_checkout_selected','protected_checkout_completed') then raise exception 'Unsupported analytics event';end if;
if p_entity_type is not null and p_entity_type not in('listing','order','conversation','review','report','seller','local_sale') then raise exception 'Unsupported entity type';end if;
if jsonb_typeof(coalesce(p_metadata,'{}'))<>'object' or octet_length(coalesce(p_metadata,'{}')::text)>2048 then raise exception 'Invalid analytics metadata';end if;
if(select count(*) from public.marketplace_analytics_events where user_id=v_actor and created_at>now()-interval '1 hour')>=120 then return;end if;
select coalesce(jsonb_object_agg(key,value),'{}') into v_safe from jsonb_each(coalesce(p_metadata,'{}')) where key in('category','fulfillment_type','result_status','filter_count','price_bucket','screen','method');
insert into public.marketplace_analytics_events(user_id,event_name,entity_type,entity_id,safe_metadata)values(v_actor,p_event_name,p_entity_type,p_entity_id,v_safe);
end;$$;

create function public.get_hybrid_local_metrics_v1() returns jsonb language sql security definer stable set search_path='' as $$
select case when auth.role()<>'service_role' then null else jsonb_build_object(
  'localDirectStarted',(select count(*) from public.local_sale_confirmations),
  'localDirectConfirmed',(select count(*) from public.local_sale_confirmations where status='confirmed'),
  'localDirectCompletionRate',(select coalesce(round(100.0*count(*) filter(where status='confirmed')/nullif(count(*),0),1),0) from public.local_sale_confirmations),
  'localDirectAverageItemValue',(select coalesce(round(avg(listing_price_snapshot),2),0) from public.local_sale_confirmations where status='confirmed'),
  'protectedCheckoutSelected',(select count(*) from public.marketplace_analytics_events where event_name='protected_checkout_selected'),
  'protectedCheckoutCompleted',(select count(*) from public.marketplace_analytics_events where event_name='protected_checkout_completed'),
  'protectedAverageItemValueCents',(select coalesce(round(avg(item_amount)),0) from public.orders where payment_status='succeeded')
) end;$$;

revoke all on function public.get_direct_local_sale_buyers_v1(uuid),public.start_direct_local_sale_v1(uuid,uuid),public.respond_direct_local_sale_v1(uuid,boolean),public.cancel_direct_local_sale_v1(uuid),public.get_local_sale_review_status_v1(uuid),public.submit_local_sale_review_v1(uuid,smallint,text) from public,anon;
grant execute on function public.get_direct_local_sale_buyers_v1(uuid),public.start_direct_local_sale_v1(uuid,uuid),public.respond_direct_local_sale_v1(uuid,boolean),public.cancel_direct_local_sale_v1(uuid),public.get_local_sale_review_status_v1(uuid),public.submit_local_sale_review_v1(uuid,smallint,text) to authenticated;
revoke all on function public.get_hybrid_local_metrics_v1() from public,anon,authenticated;
grant execute on function public.get_hybrid_local_metrics_v1() to service_role;

-- Checkout's existing SELECT FOR UPDATE plus active-status requirement prevents overlap once direct sale locks the listing.
-- No INSERT/UPDATE/DELETE table grants exist for normal users; all transitions occur through the RPCs above.

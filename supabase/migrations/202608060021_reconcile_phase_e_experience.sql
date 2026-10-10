-- Reconcile Phase E review state and notification foundation.
-- Notification enqueue failures must never roll back authoritative marketplace transitions.

alter table public.marketplace_notification_events
  add column event_key text;

update public.marketplace_notification_events
set event_key = 'legacy:' || id::text
where event_key is null;

alter table public.marketplace_notification_events
  alter column event_key set not null;

create unique index marketplace_notification_events_event_key_uidx
  on public.marketplace_notification_events(event_key);

alter table public.marketplace_notification_events
  drop constraint marketplace_notification_events_event_type_check;

alter table public.marketplace_notification_events
  add constraint marketplace_notification_events_event_type_check check (event_type in (
    'new_message','order_placed','shipment','pickup_ready','pickup_completed',
    'inspection_started','review_reminder','review_submitted','payout_completed'
  ));

create function public.get_order_review_status(p_order_id uuid)
returns table (eligible boolean, reviewed boolean, direction text)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_direction text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_actor not in (v_order.buyer_id, v_order.seller_id) then
    raise exception using errcode = 'P0002', message = 'Order unavailable.';
  end if;
  v_direction := case when v_actor = v_order.buyer_id then 'buyer_to_seller' else 'seller_to_buyer' end;
  return query select
    v_order.fulfillment_status = 'completed' and v_order.completed_at is not null,
    exists(select 1 from public.marketplace_reviews r where r.order_id = p_order_id and r.reviewer_id = v_actor),
    v_direction;
end;
$$;

revoke all on function public.get_order_review_status(uuid) from public;
grant execute on function public.get_order_review_status(uuid) to authenticated;

create function public.enqueue_phase_e_order_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.payment_status = 'succeeded' and old.payment_status is distinct from 'succeeded' then
      insert into public.marketplace_notification_events(event_key,user_id,event_type,order_id,listing_id,payload)
      values ('order:'||new.id||':confirmed',new.seller_id,'order_placed',new.id,new.listing_id,jsonb_build_object('orderId',new.id,'listingId',new.listing_id))
      on conflict (event_key) do nothing;
    end if;
    if new.fulfillment_status = 'pickup_ready' and old.fulfillment_status is distinct from 'pickup_ready' then
      insert into public.marketplace_notification_events(event_key,user_id,event_type,order_id,listing_id,payload)
      values ('order:'||new.id||':pickup_ready',new.buyer_id,'pickup_ready',new.id,new.listing_id,jsonb_build_object('orderId',new.id,'listingId',new.listing_id))
      on conflict (event_key) do nothing;
    end if;
    if new.fulfillment_status = 'shipped' and old.fulfillment_status is distinct from 'shipped' then
      insert into public.marketplace_notification_events(event_key,user_id,event_type,order_id,listing_id,payload)
      values ('order:'||new.id||':shipped',new.buyer_id,'shipment',new.id,new.listing_id,jsonb_build_object('orderId',new.id,'listingId',new.listing_id))
      on conflict (event_key) do nothing;
    end if;
    if new.fulfillment_status = 'pickup_confirmed' and old.fulfillment_status is distinct from 'pickup_confirmed' then
      insert into public.marketplace_notification_events(event_key,user_id,event_type,order_id,listing_id,payload)
      values ('order:'||new.id||':pickup_completed:buyer',new.buyer_id,'pickup_completed',new.id,new.listing_id,jsonb_build_object('orderId',new.id,'listingId',new.listing_id))
      on conflict (event_key) do nothing;
    end if;
    if new.fulfillment_status = 'inspection_window' and old.fulfillment_status is distinct from 'inspection_window' then
      insert into public.marketplace_notification_events(event_key,user_id,event_type,order_id,listing_id,payload)
      values ('order:'||new.id||':inspection',new.buyer_id,'inspection_started',new.id,new.listing_id,jsonb_build_object('orderId',new.id,'listingId',new.listing_id))
      on conflict (event_key) do nothing;
    end if;
    if new.fulfillment_status = 'completed' and old.fulfillment_status is distinct from 'completed' then
      insert into public.marketplace_notification_events(event_key,user_id,event_type,order_id,listing_id,payload) values
        ('order:'||new.id||':review_reminder:buyer',new.buyer_id,'review_reminder',new.id,new.listing_id,jsonb_build_object('orderId',new.id,'listingId',new.listing_id)),
        ('order:'||new.id||':review_reminder:seller',new.seller_id,'review_reminder',new.id,new.listing_id,jsonb_build_object('orderId',new.id,'listingId',new.listing_id))
      on conflict (event_key) do nothing;
    end if;
    if new.transfer_status = 'transferred' and old.transfer_status is distinct from 'transferred' then
      insert into public.marketplace_notification_events(event_key,user_id,event_type,order_id,listing_id,payload)
      values ('order:'||new.id||':payout_completed',new.seller_id,'payout_completed',new.id,new.listing_id,jsonb_build_object('orderId',new.id,'listingId',new.listing_id))
      on conflict (event_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke all on function public.enqueue_phase_e_order_events() from public, anon, authenticated;
create trigger orders_enqueue_phase_e_events
after update of payment_status, fulfillment_status, transfer_status on public.orders
for each row execute function public.enqueue_phase_e_order_events();

create function public.enqueue_phase_e_review_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.marketplace_notification_events(event_key,user_id,event_type,order_id,payload)
    values ('review:'||new.id,new.reviewee_id,'review_submitted',new.order_id,jsonb_build_object('orderId',new.order_id,'reviewId',new.id))
    on conflict (event_key) do nothing;
  exception when others then null;
  end;
  return new;
end;
$$;
revoke all on function public.enqueue_phase_e_review_event() from public, anon, authenticated;
create trigger reviews_enqueue_phase_e_event
after insert on public.marketplace_reviews
for each row execute function public.enqueue_phase_e_review_event();

comment on column public.marketplace_notification_events.event_key is
  'Server-derived stable logical event key used to suppress duplicate webhook, reconciliation, and transition events.';

-- Phase 2B.1: local-only provider-neutral trusted-shipment foundation.
-- No provider network calls, credentials, webhooks, deadline enforcement, refunds, or transfers.

alter table public.orders drop constraint if exists orders_shipping_workflow_version_check;
alter table public.orders add constraint orders_shipping_workflow_version_check
  check (shipping_workflow_version in (1,2,3));
comment on column public.orders.shipping_workflow_version is
  '1 legacy/manual; 2 Phase 2A foundation; 3 hardened trusted-carrier workflow. Only version 3 uses trusted carrier truth.';

-- A rename preserves EXECUTE privileges.  The Phase 2A function is therefore made
-- internal explicitly, and the original public name becomes the authenticated wrapper.
alter function public.reserve_listing_for_checkout_v2(uuid,text,uuid,text,text,text,text,text,text,text)
  rename to reserve_listing_for_checkout_v2_phase2a_internal;
revoke all on function public.reserve_listing_for_checkout_v2_phase2a_internal(uuid,text,uuid,text,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.reserve_listing_for_checkout_v2_phase2a_internal(uuid,text,uuid,text,text,text,text,text,text,text)
  to service_role;

create function public.reserve_listing_for_checkout_v2(
  p_listing_id uuid,p_fulfillment_type text,p_client_checkout_key uuid,p_recipient_name text default null,p_address_line1 text default null,
  p_address_line2 text default null,p_city text default null,p_region text default null,p_postal_code text default null,p_country_code text default null
) returns table(order_id uuid,item_amount bigint,shipping_amount bigint,marketplace_fee_amount bigint,total_before_tax bigint,reservation_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_result record;
begin
  -- The internal helper retains its own authenticated-user and reservation checks.
  select * into v_result from public.reserve_listing_for_checkout_v2_phase2a_internal(
    p_listing_id,p_fulfillment_type,p_client_checkout_key,p_recipient_name,p_address_line1,p_address_line2,p_city,p_region,p_postal_code,p_country_code);
  if p_fulfillment_type='shipping' then
    update public.orders set shipping_workflow_version=3 where id=v_result.order_id and shipping_workflow_version=2;
  end if;
  return query select v_result.order_id,v_result.item_amount,v_result.shipping_amount,v_result.marketplace_fee_amount,v_result.total_before_tax,v_result.reservation_expires_at;
end;
$$;
revoke all on function public.reserve_listing_for_checkout_v2(uuid,text,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_listing_for_checkout_v2(uuid,text,uuid,text,text,text,text,text,text,text) to authenticated;

alter table public.order_shipments
  add column shipment_state text not null default 'legacy_manual'
    check (shipment_state in ('legacy_manual','tracking_entered','tracking_validating','pre_shipment','carrier_accepted','in_transit','delivered','exception','invalid','verification_delayed')),
  add column status_source text not null default 'legacy_manual'
    check (status_source in ('legacy_manual','seller_supplied','provider_test','provider')),
  add column provider_name text,
  add column provider_tracker_id text,
  add column provider_status text,
  add column provider_status_code text,
  add column provider_event_at timestamptz,
  add column tracking_submitted_at timestamptz,
  add column carrier_accepted_at timestamptz,
  add column last_verification_attempt_at timestamptz,
  add column last_verified_at timestamptz,
  add column verification_error_code text,
  add column tracking_version smallint not null default 1 check (tracking_version between 1 and 3),
  add column correction_count smallint not null default 0 check (correction_count between 0 and 2);
comment on column public.order_shipments.shipped_at is
  'Legacy/manual seller-reported time only. Hardened tracking submission never writes it; carrier_accepted_at is trusted acceptance.';
alter table public.order_shipments add constraint order_shipments_trusted_state_check check (
  shipment_state not in ('carrier_accepted','in_transit','delivered')
  or (carrier_accepted_at is not null and status_source in ('provider_test','provider'))
);
create unique index order_shipments_active_tracking_unique on public.order_shipments(carrier,tracking_number)
  where shipment_state in ('tracking_entered','tracking_validating','pre_shipment','carrier_accepted','in_transit','exception','verification_delayed');

create table public.order_shipment_events (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
  shipment_state text not null check (shipment_state in ('tracking_entered','tracking_validating','pre_shipment','carrier_accepted','in_transit','delivered','exception','invalid','verification_delayed')),
  status_source text not null check (status_source in ('seller_supplied','provider_test','provider')),
  provider_name text, provider_event_id text, provider_status text, provider_status_code text,
  occurred_at timestamptz not null, received_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and octet_length(details::text)<=1024),
  unique(provider_name,provider_event_id)
);
alter table public.order_shipment_events enable row level security;
revoke all on table public.order_shipment_events from public,anon,authenticated;
grant select,insert on table public.order_shipment_events to service_role;

create function public.normalize_shipping_carrier_v1(p_carrier text) returns text language plpgsql immutable set search_path='' as $$
declare v text:=upper(btrim(coalesce(p_carrier,''))); begin
  if v in ('USPS','UNITED STATES POSTAL SERVICE') then return 'USPS'; end if;
  if v in ('UPS','UNITED PARCEL SERVICE') then return 'UPS'; end if;
  if v in ('FEDEX','FEDERAL EXPRESS') then return 'FEDEX'; end if;
  raise exception using errcode='22023',message='Unsupported carrier.';
end; $$;
create function public.normalize_shipping_tracking_v1(p_tracking text) returns text language plpgsql immutable set search_path='' as $$
declare v text:=upper(regexp_replace(btrim(coalesce(p_tracking,'')),'[[:space:]-]','','g')); begin
  if v !~ '^[A-Z0-9]{8,40}$' then raise exception using errcode='22023',message='Invalid tracking number.'; end if; return v;
end; $$;

create function public.submit_order_shipment_tracking_v1(p_order_id uuid,p_seller_id uuid,p_carrier text,p_tracking_number text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_shipment public.order_shipments%rowtype; v_carrier text; v_tracking text; v_changed boolean;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='Trusted backend required.'; end if;
  v_carrier:=public.normalize_shipping_carrier_v1(p_carrier); v_tracking:=public.normalize_shipping_tracking_v1(p_tracking_number);
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.seller_id<>p_seller_id then raise exception using errcode='42501',message='Order access denied.'; end if;
  if v_order.fulfillment_type<>'shipping' or v_order.payment_status<>'succeeded' or v_order.shipping_workflow_version<>3 or v_order.fulfillment_status<>'awaiting_shipment' then raise exception using errcode='55000',message='Tracking submission is unavailable.'; end if;
  select * into v_shipment from public.order_shipments where order_id=p_order_id for update;
  if found and v_shipment.shipment_state in ('carrier_accepted','in_transit','delivered') then raise exception using errcode='55000',message='Carrier-accepted tracking requires manual review.'; end if;
  v_changed:=not found or v_shipment.carrier<>v_carrier or v_shipment.tracking_number<>v_tracking;
  if found and v_changed and v_shipment.correction_count>=2 then raise exception using errcode='55000',message='Tracking correction limit reached.'; end if;
  if found then update public.order_shipments set carrier=v_carrier,tracking_number=v_tracking,shipment_state='tracking_entered',status_source='seller_supplied',provider_name=null,provider_tracker_id=null,provider_status=null,provider_status_code=null,provider_event_at=null,carrier_accepted_at=null,delivered_at=null,last_verification_attempt_at=now(),last_verified_at=null,verification_error_code=null,correction_count=case when v_changed then correction_count+1 else correction_count end,tracking_version=case when v_changed then tracking_version+1 else tracking_version end,tracking_submitted_at=now() where order_id=p_order_id;
  else insert into public.order_shipments(order_id,carrier,tracking_number,shipment_state,status_source,tracking_submitted_at,last_verification_attempt_at) values(p_order_id,v_carrier,v_tracking,'tracking_entered','seller_supplied',now(),now()); end if;
  insert into public.order_shipment_events(order_id,shipment_state,status_source,occurred_at,details) values(p_order_id,'tracking_entered','seller_supplied',now(),jsonb_build_object('correction',v_changed,'priorCarrier',case when v_changed and v_shipment.order_id is not null then v_shipment.carrier else null end,'priorTracking',case when v_changed and v_shipment.order_id is not null then v_shipment.tracking_number else null end,'carrier',v_carrier,'tracking',v_tracking));
  return v_order;
end; $$;

create function public.apply_trusted_shipment_event_v1(p_order_id uuid,p_provider_name text,p_provider_event_id text,p_provider_tracker_id text,p_shipment_state text,p_occurred_at timestamptz,p_provider_status text default null,p_provider_status_code text default null,p_test_mode boolean default false)
returns public.orders language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_shipment public.order_shipments%rowtype; v_event public.order_shipment_events%rowtype; v_source text; v_rank int; v_current_rank int; v_provider text:=btrim(coalesce(p_provider_name,'')); v_tracker text:=btrim(coalesce(p_provider_tracker_id,''));
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='Trusted provider processing required.'; end if;
  if v_provider='' or btrim(coalesce(p_provider_event_id,''))='' or v_tracker='' or p_occurred_at is null or p_shipment_state not in ('tracking_validating','pre_shipment','carrier_accepted','in_transit','delivered','exception','invalid','verification_delayed') then raise exception using errcode='22023',message='Invalid trusted shipment event.'; end if;
  select * into v_event from public.order_shipment_events where provider_name=v_provider and provider_event_id=btrim(p_provider_event_id);
  if found then if v_event.order_id<>p_order_id then raise exception using errcode='22023',message='Provider event binding mismatch.'; end if; select * into v_order from public.orders where id=p_order_id; return v_order; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.fulfillment_type<>'shipping' or v_order.shipping_workflow_version<>3 then raise exception using errcode='55000',message='Trusted shipment workflow is unavailable.'; end if;
  select * into v_shipment from public.order_shipments where order_id=p_order_id for update;
  if not found or v_shipment.shipment_state='legacy_manual' then raise exception using errcode='55000',message='Tracking has not been submitted.'; end if;
  if v_shipment.provider_name is not null and v_shipment.provider_name<>v_provider then raise exception using errcode='22023',message='Provider binding mismatch.'; end if;
  if v_shipment.provider_tracker_id is not null and v_shipment.provider_tracker_id<>v_tracker then raise exception using errcode='22023',message='Provider tracker binding mismatch.'; end if;
  if p_occurred_at<coalesce(v_shipment.provider_event_at,'epoch'::timestamptz) and p_shipment_state<>'exception' then raise exception using errcode='55000',message='Stale provider event.'; end if;
  v_rank:=case p_shipment_state when 'tracking_validating' then 2 when 'pre_shipment' then 3 when 'carrier_accepted' then 4 when 'in_transit' then 5 when 'delivered' then 6 else 0 end;
  v_current_rank:=case v_shipment.shipment_state when 'tracking_entered' then 1 when 'tracking_validating' then 2 when 'pre_shipment' then 3 when 'carrier_accepted' then 4 when 'in_transit' then 5 when 'delivered' then 6 else 0 end;
  if v_current_rank=6 and p_shipment_state<>'delivered' then raise exception using errcode='55000',message='Delivered shipment cannot regress.'; end if;
  if v_rank>0 and v_current_rank>v_rank then raise exception using errcode='55000',message='Shipment state cannot regress.'; end if;
  v_source:=case when p_test_mode then 'provider_test' else 'provider' end;
  insert into public.order_shipment_events(order_id,shipment_state,status_source,provider_name,provider_event_id,provider_status,provider_status_code,occurred_at) values(p_order_id,p_shipment_state,v_source,v_provider,btrim(p_provider_event_id),left(p_provider_status,100),left(p_provider_status_code,100),p_occurred_at);
  update public.order_shipments set shipment_state=p_shipment_state,status_source=v_source,provider_name=v_provider,provider_tracker_id=left(v_tracker,120),provider_status=left(p_provider_status,100),provider_status_code=left(p_provider_status_code,100),provider_event_at=greatest(coalesce(provider_event_at,'epoch'::timestamptz),p_occurred_at),last_verification_attempt_at=now(),last_verified_at=now(),verification_error_code=null,carrier_accepted_at=case when p_shipment_state in ('carrier_accepted','in_transit','delivered') then coalesce(carrier_accepted_at,p_occurred_at) else carrier_accepted_at end,delivered_at=case when p_shipment_state='delivered' then coalesce(delivered_at,p_occurred_at) else delivered_at end where order_id=p_order_id;
  if p_shipment_state in ('carrier_accepted','in_transit') then update public.orders set fulfillment_status='shipped',shipped_at=coalesce(shipped_at,p_occurred_at) where id=p_order_id and fulfillment_status='awaiting_shipment';
  elsif p_shipment_state='delivered' then update public.orders set fulfillment_status='inspection_window',delivered_at=coalesce(delivered_at,p_occurred_at),inspection_expires_at=coalesce(inspection_expires_at,p_occurred_at+interval '48 hours'),transfer_status='on_hold' where id=p_order_id; end if;
  select * into v_order from public.orders where id=p_order_id; return v_order;
end; $$;

-- Legacy server routes remain compatible only for workflow versions 1 and 2.
create or replace function public.mark_order_shipped(p_order_id uuid,p_seller_id uuid,p_carrier text,p_tracking_number text,p_shipped_at timestamptz) returns public.orders language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='Trusted backend required.'; end if;
  if upper(btrim(coalesce(p_carrier,''))) not in ('USPS','UPS','FEDEX') or char_length(btrim(coalesce(p_tracking_number,''))) not between 3 and 120 or p_shipped_at is null or p_shipped_at>now()+interval '5 minutes' then raise exception using errcode='22023',message='Invalid shipment details.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.seller_id<>p_seller_id then raise exception using errcode='42501',message='Order access denied.'; end if;
  if v_order.shipping_workflow_version=3 then raise exception using errcode='55000',message='Hardened tracking submission is required.'; end if;
  if v_order.fulfillment_type<>'shipping' or v_order.payment_status<>'succeeded' or v_order.fulfillment_status<>'awaiting_shipment' then raise exception using errcode='55000',message='Invalid order state.'; end if;
  insert into public.order_shipments(order_id,carrier,tracking_number,shipped_at) values(p_order_id,upper(btrim(p_carrier)),btrim(p_tracking_number),p_shipped_at) on conflict(order_id) do nothing;
  update public.orders set fulfillment_status='shipped',shipped_at=p_shipped_at where id=p_order_id returning * into v_order; return v_order;
end; $$;
create or replace function public.mark_order_delivered(p_order_id uuid,p_buyer_id uuid) returns public.orders language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='Trusted backend required.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.buyer_id<>p_buyer_id then raise exception using errcode='42501',message='Order access denied.'; end if;
  if v_order.shipping_workflow_version=3 then raise exception using errcode='55000',message='Carrier-confirmed delivery is required.'; end if;
  if v_order.fulfillment_type<>'shipping' or v_order.payment_status<>'succeeded' or v_order.fulfillment_status<>'shipped' then raise exception using errcode='55000',message='Invalid order state.'; end if;
  update public.order_shipments set delivered_at=coalesce(delivered_at,now()) where order_id=p_order_id;
  update public.orders set fulfillment_status='inspection_window',delivered_at=coalesce(delivered_at,now()),transfer_status='on_hold',inspection_expires_at=coalesce(inspection_expires_at,now()+interval '48 hours') where id=p_order_id returning * into v_order; return v_order;
end; $$;

revoke all on function public.normalize_shipping_carrier_v1(text),public.normalize_shipping_tracking_v1(text) from public,anon,authenticated;
revoke all on function public.submit_order_shipment_tracking_v1(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.apply_trusted_shipment_event_v1(uuid,text,text,text,text,timestamptz,text,text,boolean) from public,anon,authenticated;
grant execute on function public.submit_order_shipment_tracking_v1(uuid,uuid,text,text),public.apply_trusted_shipment_event_v1(uuid,text,text,text,text,timestamptz,text,text,boolean) to service_role;
-- `tracking_entered`, validation, acceptance, and transit never change payout eligibility.

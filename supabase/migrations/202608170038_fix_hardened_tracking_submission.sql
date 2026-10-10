-- Phase 2B.1 corrective migration: legacy manual shipment rows required shipped_at,
-- but hardened tracking is intentionally not shipment proof.
alter table public.order_shipments alter column shipped_at drop not null;
comment on column public.order_shipments.shipped_at is
  'Legacy/manual seller-reported time only. Null for hardened tracking until trusted carrier acceptance.';

create or replace function public.submit_order_shipment_tracking_v1(p_order_id uuid,p_seller_id uuid,p_carrier text,p_tracking_number text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_shipment public.order_shipments%rowtype; v_carrier text; v_tracking text; v_changed boolean;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='Trusted backend required.'; end if;
  v_carrier:=public.normalize_shipping_carrier_v1(p_carrier); v_tracking:=public.normalize_shipping_tracking_v1(p_tracking_number);
  if (v_carrier='UPS' and v_tracking !~ '^1Z[0-9A-Z]{16}$')
    or (v_carrier='USPS' and v_tracking !~ '^([0-9]{20,22}|[A-Z]{2}[0-9]{9}US)$')
    or (v_carrier='FEDEX' and v_tracking !~ '^[0-9]{12}$|^[0-9]{15}$|^[0-9]{20}$|^[0-9]{22}$|^[0-9]{34}$') then
    raise exception using errcode='22023',message='Tracking format does not match carrier.';
  end if;
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
  select * into v_order from public.orders where id=p_order_id;
  return v_order;
end; $$;

revoke all on function public.submit_order_shipment_tracking_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_order_shipment_tracking_v1(uuid,uuid,text,text) to service_role;

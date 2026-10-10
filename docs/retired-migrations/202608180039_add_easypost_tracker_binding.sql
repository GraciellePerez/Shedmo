-- Phase 2B.2B: EasyPost tracker lookup index and additive trusted-event hardening.
-- Local-only. Does not schedule polling, refunds, or deadline workers.

create unique index if not exists order_shipments_provider_tracker_unique
  on public.order_shipments(provider_name, provider_tracker_id)
  where provider_tracker_id is not null;

create or replace function public.apply_trusted_shipment_event_v1(
  p_order_id uuid,p_provider_name text,p_provider_event_id text,p_provider_tracker_id text,p_shipment_state text,p_occurred_at timestamptz,p_provider_status text default null,p_provider_status_code text default null,p_test_mode boolean default false
) returns public.orders language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype; v_shipment public.order_shipments%rowtype; v_event public.order_shipment_events%rowtype; v_source text; v_rank int; v_current_rank int; v_provider text:=btrim(coalesce(p_provider_name,'')); v_tracker text:=btrim(coalesce(p_provider_tracker_id,''));
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='Trusted provider processing required.'; end if;
  if v_provider='' or btrim(coalesce(p_provider_event_id,''))='' or p_occurred_at is null or p_shipment_state not in ('tracking_validating','pre_shipment','carrier_accepted','in_transit','delivered','exception','invalid','verification_delayed') then raise exception using errcode='22023',message='Invalid trusted shipment event.'; end if;
  if v_tracker='' and p_shipment_state not in ('verification_delayed','invalid') then raise exception using errcode='22023',message='Invalid trusted shipment event.'; end if;
  select * into v_event from public.order_shipment_events where provider_name=v_provider and provider_event_id=btrim(p_provider_event_id);
  if found then if v_event.order_id<>p_order_id then raise exception using errcode='22023',message='Provider event binding mismatch.'; end if; select * into v_order from public.orders where id=p_order_id; return v_order; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.fulfillment_type<>'shipping' or v_order.shipping_workflow_version<>3 then raise exception using errcode='55000',message='Trusted shipment workflow is unavailable.'; end if;
  select * into v_shipment from public.order_shipments where order_id=p_order_id for update;
  if not found or v_shipment.shipment_state='legacy_manual' then raise exception using errcode='55000',message='Tracking has not been submitted.'; end if;
  if v_tracker<>'' then
    if v_shipment.provider_name is not null and v_shipment.provider_name<>v_provider then raise exception using errcode='22023',message='Provider binding mismatch.'; end if;
    if v_shipment.provider_tracker_id is not null and v_shipment.provider_tracker_id<>v_tracker then raise exception using errcode='22023',message='Provider tracker binding mismatch.'; end if;
    if exists (select 1 from public.order_shipments s where s.provider_name=v_provider and s.provider_tracker_id=v_tracker and s.order_id<>p_order_id) then raise exception using errcode='22023',message='Provider tracker binding mismatch.'; end if;
  end if;
  if p_occurred_at<coalesce(v_shipment.provider_event_at,'epoch'::timestamptz) and p_shipment_state not in ('exception','verification_delayed') then raise exception using errcode='55000',message='Stale provider event.'; end if;
  v_rank:=case p_shipment_state when 'tracking_validating' then 2 when 'pre_shipment' then 3 when 'carrier_accepted' then 4 when 'in_transit' then 5 when 'delivered' then 6 else 0 end;
  v_current_rank:=case v_shipment.shipment_state when 'tracking_entered' then 1 when 'tracking_validating' then 2 when 'pre_shipment' then 3 when 'carrier_accepted' then 4 when 'in_transit' then 5 when 'delivered' then 6 else 0 end;
  if v_current_rank=6 and p_shipment_state<>'delivered' then raise exception using errcode='55000',message='Delivered shipment cannot regress.'; end if;
  if v_rank>0 and v_current_rank>v_rank then raise exception using errcode='55000',message='Shipment state cannot regress.'; end if;
  if p_shipment_state in ('verification_delayed','invalid') and v_current_rank>=4 then select * into v_order from public.orders where id=p_order_id; return v_order; end if;
  v_source:=case when p_test_mode then 'provider_test' else 'provider' end;
  insert into public.order_shipment_events(order_id,shipment_state,status_source,provider_name,provider_event_id,provider_status,provider_status_code,occurred_at) values(p_order_id,p_shipment_state,v_source,v_provider,btrim(p_provider_event_id),left(p_provider_status,100),left(p_provider_status_code,100),p_occurred_at);
  -- First trusted in_transit evidence records carrier_accepted_at and current in-transit state together.
  update public.order_shipments set shipment_state=p_shipment_state,status_source=v_source,provider_name=v_provider,provider_tracker_id=case when v_tracker='' then provider_tracker_id else left(v_tracker,120) end,provider_status=left(p_provider_status,100),provider_status_code=left(p_provider_status_code,100),provider_event_at=case when p_shipment_state='verification_delayed' then provider_event_at else greatest(coalesce(provider_event_at,'epoch'::timestamptz),p_occurred_at) end,last_verification_attempt_at=now(),last_verified_at=case when p_shipment_state='verification_delayed' then last_verified_at else now() end,verification_error_code=case when p_shipment_state in ('verification_delayed','invalid') then left(coalesce(p_provider_status_code,p_provider_status),100) else null end,carrier_accepted_at=case when p_shipment_state in ('carrier_accepted','in_transit','delivered') then coalesce(carrier_accepted_at,p_occurred_at) else carrier_accepted_at end,delivered_at=case when p_shipment_state='delivered' then coalesce(delivered_at,p_occurred_at) else delivered_at end where order_id=p_order_id;
  if p_shipment_state in ('carrier_accepted','in_transit') then update public.orders set fulfillment_status='shipped',shipped_at=coalesce(shipped_at,p_occurred_at) where id=p_order_id and fulfillment_status='awaiting_shipment';
  elsif p_shipment_state='delivered' then update public.orders set fulfillment_status='inspection_window',delivered_at=coalesce(delivered_at,p_occurred_at),inspection_expires_at=coalesce(inspection_expires_at,p_occurred_at+interval '48 hours'),transfer_status='on_hold' where id=p_order_id; end if;
  select * into v_order from public.orders where id=p_order_id; return v_order;
end; $$;

revoke all on function public.apply_trusted_shipment_event_v1(uuid,text,text,text,text,timestamptz,text,text,boolean) from public,anon,authenticated;
grant execute on function public.apply_trusted_shipment_event_v1(uuid,text,text,text,text,timestamptz,text,text,boolean) to service_role;

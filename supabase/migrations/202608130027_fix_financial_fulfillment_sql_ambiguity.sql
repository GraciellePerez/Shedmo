-- Qualify identifiers that conflict with TABLE return-column variables in
-- PL/pgSQL. These functions remain service-role-only.

create or replace function public.consume_pickup_pin_v1(
  p_order_id uuid, p_seller_id uuid, p_pin text
)
returns table(order_id uuid, result text)
language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_pickup public.pickup_tokens%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception using errcode = '22023', message = 'Invalid pickup PIN.'; end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.fulfillment_type <> 'pickup' or v_order.payment_status <> 'succeeded'
    or v_order.fulfillment_status <> 'pickup_ready' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  select * into v_pickup from public.pickup_tokens pt
  where pt.order_id = p_order_id and pt.buyer_id = v_order.buyer_id and pt.used_at is null for update;
  if not found or v_pickup.expires_at <= now() then return query select p_order_id, 'expired'::text; return; end if;
  if v_pickup.pin_locked_at is not null or v_pickup.failed_pin_attempts >= 5 then return query select p_order_id, 'locked'::text; return; end if;
  if v_pickup.pin_hash is null or v_pickup.pin_hash <> encode(extensions.digest(p_pin, 'sha256'), 'hex') then
    update public.pickup_tokens pt set failed_pin_attempts = least(pt.failed_pin_attempts + 1, 10),
      pin_locked_at = case when pt.failed_pin_attempts + 1 >= 5 then now() else pt.pin_locked_at end
    where pt.id = v_pickup.id;
    return query select p_order_id, 'invalid'::text; return;
  end if;
  update public.pickup_tokens pt set used_at = now() where pt.id = v_pickup.id and pt.used_at is null;
  update public.orders o set fulfillment_status = 'pickup_confirmed',
    pickup_confirmed_at = coalesce(o.pickup_confirmed_at, now()), transfer_status = 'on_hold'
  where o.id = p_order_id;
  perform public.phase_d3_make_order_eligible(p_order_id);
  return query select p_order_id, 'completed'::text;
end;
$$;

-- The current D3.1 payout function supersedes the original D2 definition.
-- Its ON CONFLICT target is qualified to avoid the output-column collision.
create or replace function public.claim_seller_payout(p_order_id uuid, p_seller_id uuid)
returns table(order_id uuid, seller_account_id text, source_charge_id text, amount bigint, currency text, already_transferred boolean)
language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_account public.seller_payment_accounts%rowtype;
  v_release public.seller_payout_releases%rowtype; v_payment public.payments%rowtype;
  v_amount bigint; v_processing bigint; v_adjustments bigint;
begin
  if auth.role() <> 'service_role' then raise exception using errcode='42501',message='Trusted backend required.'; end if;
  select * into v_order from public.orders o where o.id=p_order_id for update;
  if not found or v_order.seller_id<>p_seller_id then raise exception using errcode='42501',message='Order access denied.'; end if;
  if v_order.payment_status<>'succeeded' or v_order.dispute_status<>'none'
    or v_order.fulfillment_status not in ('pickup_confirmed','delivered','completed')
    or v_order.transfer_status not in ('eligible','pending','reconciling','transferred','settled','failed')
    or v_order.payout_not_before is null or v_order.payout_not_before>now()
    or v_order.refund_status in ('pending','reconciling') then raise exception using errcode='55000',message='Payout is not eligible.'; end if;
  select * into v_account from public.seller_payment_accounts spa where spa.user_id=p_seller_id for update;
  if not found or v_account.risk_tier='restricted' or v_account.stripe_account_id is null
    or v_account.onboarding_status<>'enabled' or not v_account.payouts_enabled
    or v_account.transfer_capability_status<>'active' then raise exception using errcode='55000',message='Seller payouts are unavailable.'; end if;
  select * into v_payment from public.payments p where p.order_id=p_order_id;
  if not found or v_payment.status<>'succeeded' or v_payment.stripe_charge_id is null
    or v_payment.processing_fee_status<>'reconciled' or v_payment.actual_processing_fee_amount is null then raise exception using errcode='55000',message='Payment fee reconciliation is required.'; end if;
  v_processing:=v_payment.actual_processing_fee_amount;
  select coalesce(sum(a.remaining_amount),0) into v_adjustments from public.seller_financial_adjustments a
    where a.seller_id=p_seller_id and a.status='pending' and a.remaining_amount>0;
  v_amount:=greatest(0,v_order.item_amount+v_order.shipping_amount-v_order.marketplace_fee_amount-v_processing-v_order.reserve_withheld_amount-v_adjustments);
  insert into public.seller_payout_releases(order_id,amount,currency,processing_fee_amount,financial_adjustment_amount)
  values(p_order_id,v_amount,v_order.currency,v_processing,v_adjustments)
  on conflict on constraint seller_payout_releases_order_id_key do nothing;
  select * into v_release from public.seller_payout_releases spr where spr.order_id=p_order_id for update;
  if v_release.amount<>v_amount or v_release.currency<>v_order.currency then raise exception using errcode='22023',message='Payout data mismatch.'; end if;
  update public.orders o set transfer_status=case when v_release.status in ('transferred','settled') then o.transfer_status else 'pending' end,
    seller_transfer_amount=v_amount, actual_processing_amount=v_processing where o.id=p_order_id;
  return query select p_order_id,v_account.stripe_account_id,v_payment.stripe_charge_id,v_amount,v_order.currency,v_release.status in ('transferred','settled');
end;
$$;

-- Replace only the ambiguous aggregate references in the latest definitions.
do $$ begin
  execute replace(
    replace(pg_get_functiondef('public.prepare_transfer_reversal_v1(uuid)'::regprocedure),
      'sum(amount)', 'sum(tr.amount)'),
    'from public.transfer_reversals' || chr(10) || '    where',
    'from public.transfer_reversals tr' || chr(10) || '    where'
  );
exception when others then raise; end $$;

do $$ begin
  execute replace(
    replace(pg_get_functiondef('public.prepare_chargeback_reversal_v1(uuid)'::regprocedure),
      'sum(amount)', 'sum(tr.amount)'),
    'from public.transfer_reversals' || chr(10) || '    where',
    'from public.transfer_reversals tr' || chr(10) || '    where'
  );
exception when others then raise; end $$;

revoke all on function public.consume_pickup_pin_v1(uuid,uuid,text),
  public.claim_seller_payout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.consume_pickup_pin_v1(uuid,uuid,text),
  public.claim_seller_payout(uuid,uuid) to service_role;

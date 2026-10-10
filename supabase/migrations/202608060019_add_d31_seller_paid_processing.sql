-- Phase D3.1: seller-paid actual Stripe processing cost and refund liabilities.

alter table public.payments
  add column actual_processing_fee_amount bigint
    check (actual_processing_fee_amount is null or actual_processing_fee_amount >= 0),
  add column processing_fee_status text not null default 'pending'
    check (processing_fee_status in ('pending','reconciling','reconciled','manual_review')),
  add column processing_fee_reconciled_at timestamptz,
  add column stripe_balance_transaction_id text unique;

create table public.seller_financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  adjustment_type text not null check (adjustment_type in (
    'seller_cancellation_processing_fee','refund_liability','dispute_loss','manual_adjustment'
  )),
  amount bigint not null check (amount > 0),
  remaining_amount bigint not null check (remaining_amount between 0 and amount),
  status text not null default 'pending' check (status in ('pending','reserved','settled')),
  source_ref text not null unique,
  reserved_by_release_id uuid references public.seller_payout_releases(id) on delete restrict,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint seller_financial_adjustments_state_check check (
    (status = 'pending' and reserved_by_release_id is null and settled_at is null)
    or (status = 'reserved' and reserved_by_release_id is not null and settled_at is null)
    or (status = 'settled' and remaining_amount = 0 and settled_at is not null)
  )
);

alter table public.seller_financial_adjustments enable row level security;
create policy "Sellers read own financial adjustments"
on public.seller_financial_adjustments for select to authenticated
using (seller_id = auth.uid());
revoke all on table public.seller_financial_adjustments from anon, authenticated;
grant select (id, order_id, adjustment_type, amount, remaining_amount, status,
  created_at, settled_at) on public.seller_financial_adjustments to authenticated;
grant select, insert, update on table public.seller_financial_adjustments to service_role;
create index seller_financial_adjustments_pending_idx
  on public.seller_financial_adjustments (seller_id, created_at)
  where status = 'pending' and remaining_amount > 0;

create table public.seller_payout_adjustment_applications (
  payout_release_id uuid not null references public.seller_payout_releases(id) on delete restrict,
  adjustment_id uuid not null references public.seller_financial_adjustments(id) on delete restrict,
  amount bigint not null check (amount > 0),
  settled_at timestamptz,
  primary key (payout_release_id, adjustment_id)
);
alter table public.seller_payout_adjustment_applications enable row level security;
revoke all on table public.seller_payout_adjustment_applications from anon, authenticated;
grant select, insert, update, delete on table public.seller_payout_adjustment_applications to service_role;
create index payments_processing_fee_queue_idx
  on public.payments (updated_at)
  where status = 'succeeded' and processing_fee_status in ('pending','reconciling');

alter table public.seller_payout_releases
  drop constraint seller_payout_releases_amount_check,
  drop constraint seller_payout_releases_status_check,
  drop constraint seller_payout_release_transfer_check;
alter table public.seller_payout_releases
  add constraint seller_payout_releases_amount_check check (amount >= 0),
  add constraint seller_payout_releases_status_check check (status in ('pending','creating','reconciling','transferred','settled','failed')),
  add constraint seller_payout_release_transfer_check check (
    (status='transferred' and amount > 0 and stripe_transfer_id is not null and transferred_at is not null)
    or (status='settled' and amount = 0 and stripe_transfer_id is null)
    or status not in ('transferred','settled')
  ),
  add column processing_fee_amount bigint not null default 0 check (processing_fee_amount >= 0),
  add column refund_deduction_amount bigint not null default 0 check (refund_deduction_amount >= 0),
  add column financial_adjustment_amount bigint not null default 0 check (financial_adjustment_amount >= 0);
grant select (processing_fee_amount, refund_deduction_amount, financial_adjustment_amount)
  on public.seller_payout_releases to authenticated;

create or replace function public.reconcile_payment_processing_fee_v1(
  p_payment_id uuid, p_charge_id text, p_balance_transaction_id text,
  p_fee_amount bigint, p_currency text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_payment public.payments%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  if p_fee_amount < 0 or p_balance_transaction_id is null then
    raise exception using errcode = '22023', message = 'Invalid processing fee.';
  end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status not in ('succeeded','refund_pending','partially_refunded','refunded','disputed')
    or v_payment.stripe_charge_id <> p_charge_id or v_payment.currency <> p_currency then
    raise exception using errcode = '22023', message = 'Payment fee data mismatch.';
  end if;
  if v_payment.processing_fee_status = 'reconciled' and
    (v_payment.actual_processing_fee_amount <> p_fee_amount
      or v_payment.stripe_balance_transaction_id <> p_balance_transaction_id) then
    raise exception using errcode = '22023', message = 'Processing fee is immutable.';
  end if;
  update public.payments set actual_processing_fee_amount = p_fee_amount,
    processing_fee_status = 'reconciled', processing_fee_reconciled_at = coalesce(processing_fee_reconciled_at, now()),
    stripe_balance_transaction_id = p_balance_transaction_id where id = p_payment_id;
  update public.orders set actual_processing_amount = p_fee_amount where id = v_payment.order_id
    and (actual_processing_amount is null or actual_processing_amount = p_fee_amount);
  if not found then raise exception using errcode = '22023', message = 'Order processing fee mismatch.'; end if;
end;
$$;

create or replace function public.mark_payment_processing_fee_reconciling_v1(p_payment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  update public.payments set processing_fee_status = 'reconciling'
    where id = p_payment_id and processing_fee_status in ('pending','reconciling');
end;
$$;

create or replace function public.prepare_seller_payout_v2(p_order_id uuid, p_seller_id uuid)
returns table(release_id uuid, release_status text, stripe_transfer_id text,
  transfer_reference text, destination_account_id text, source_charge_id text,
  amount bigint, currency text, transfer_version smallint)
language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_account public.seller_payment_accounts%rowtype;
  v_payment public.payments%rowtype; v_release public.seller_payout_releases%rowtype;
  v_original bigint; v_refunds bigint; v_refund_deduction bigint; v_adjustments bigint := 0;
  v_amount bigint; v_release_id uuid := gen_random_uuid(); v_adjustment record; v_take bigint;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id or v_order.payment_status not in ('succeeded','partially_refunded')
    or v_order.dispute_status not in ('none','resolved_seller','closed')
    or v_order.refund_status not in ('none','partially_refunded')
    or v_order.fulfillment_status not in ('pickup_confirmed','delivered','completed')
    or v_order.transfer_status not in ('eligible','pending','transferred','failed','on_hold')
    or v_order.payout_not_before is null or v_order.payout_not_before > now()
    or exists (select 1 from public.order_disputes d where d.order_id = p_order_id and d.status in ('open','awaiting_seller_response','under_review'))
    or exists (select 1 from public.order_refunds r where r.order_id = p_order_id and r.status in ('pending','creating','reconciling'))
    or exists (select 1 from public.transfer_reversals r where r.order_id = p_order_id and r.status in ('creating','reconciling')) then
    raise exception using errcode = '55000', message = 'Order is not payout eligible.';
  end if;
  select * into v_account from public.seller_payment_accounts where user_id = p_seller_id for update;
  if not found or v_account.risk_tier = 'restricted' or v_account.stripe_account_id is null
    or v_account.onboarding_status <> 'enabled' or not v_account.payouts_enabled
    or v_account.transfer_capability_status <> 'active' then raise exception using errcode = '55000', message = 'Seller payouts are unavailable.'; end if;
  select * into v_payment from public.payments where order_id = p_order_id for update;
  if not found or v_payment.status not in ('succeeded','partially_refunded') or v_payment.stripe_charge_id is null
    or v_payment.processing_fee_status <> 'reconciled' or v_payment.actual_processing_fee_amount is null then
    raise exception using errcode = '55000', message = 'Payment processing fee is not reconciled.';
  end if;
  v_original := greatest(0, v_order.item_amount + v_order.shipping_amount
    - v_order.marketplace_fee_amount - v_payment.actual_processing_fee_amount - v_order.reserve_withheld_amount);
  select coalesce(sum(r.amount),0) into v_refunds from public.order_refunds r
    where r.order_id = p_order_id and r.status = 'succeeded';
  v_refund_deduction := least(v_original, v_refunds);
  v_amount := v_original - v_refund_deduction;
  if v_amount <= 0 then raise exception using errcode = '55000', message = 'No seller proceeds remain.'; end if;
  insert into public.seller_payout_releases(id, order_id, seller_id, amount, currency,
    status, source_charge_id, destination_account_id, transfer_reference,
    processing_fee_amount, refund_deduction_amount)
  values (v_release_id, p_order_id, p_seller_id, v_amount, v_order.currency, 'creating',
    v_payment.stripe_charge_id, v_account.stripe_account_id,
    'payout_release_' || replace(v_release_id::text, '-', ''),
    v_payment.actual_processing_fee_amount, v_refund_deduction)
  on conflict (order_id) do nothing;
  select * into v_release from public.seller_payout_releases where order_id = p_order_id for update;
  if v_release.status = 'transferred' then
    return query select v_release.id, v_release.status, v_release.stripe_transfer_id,
      v_release.transfer_reference, v_release.destination_account_id, v_release.source_charge_id,
      v_release.amount, v_release.currency, v_release.transfer_version; return;
  end if;
  if v_release.amount = v_amount and v_release.financial_adjustment_amount = 0 then
    for v_adjustment in select * from public.seller_financial_adjustments
      where seller_id = p_seller_id and status = 'pending' and remaining_amount > 0
      order by created_at, id for update skip locked loop
      exit when v_amount <= 0;
      v_take := least(v_amount, v_adjustment.remaining_amount);
      update public.seller_financial_adjustments set status = 'reserved',
        reserved_by_release_id = v_release.id
        where id = v_adjustment.id;
      insert into public.seller_payout_adjustment_applications(payout_release_id,adjustment_id,amount)
        values(v_release.id,v_adjustment.id,v_take) on conflict do nothing;
      v_adjustments := v_adjustments + v_take; v_amount := v_amount - v_take;
    end loop;
    update public.seller_payout_releases set amount = v_amount,
      financial_adjustment_amount = v_adjustments where id = v_release.id returning * into v_release;
  end if;
  if v_release.amount = 0 then
    update public.seller_payout_releases set status='settled' where id=v_release.id returning * into v_release;
    update public.seller_financial_adjustments a set
      remaining_amount=a.remaining_amount-x.amount,
      status=case when a.remaining_amount=x.amount then 'settled' else 'pending' end,
      reserved_by_release_id=null,
      settled_at=case when a.remaining_amount=x.amount then now() else null end
    from public.seller_payout_adjustment_applications x
    where x.payout_release_id=v_release.id and x.adjustment_id=a.id and x.settled_at is null;
    update public.seller_payout_adjustment_applications set settled_at=now()
      where payout_release_id=v_release.id and settled_at is null;
    update public.orders set transfer_status='not_eligible',seller_transfer_amount=0 where id=p_order_id;
    return query select v_release.id,v_release.status,v_release.stripe_transfer_id,
      v_release.transfer_reference,v_release.destination_account_id,v_release.source_charge_id,
      v_release.amount,v_release.currency,v_release.transfer_version; return;
  end if;
  update public.orders set transfer_status = 'pending', seller_transfer_amount = v_release.amount where id = p_order_id;
  return query select v_release.id, v_release.status, v_release.stripe_transfer_id,
    v_release.transfer_reference, v_release.destination_account_id, v_release.source_charge_id,
    v_release.amount, v_release.currency, v_release.transfer_version;
end;
$$;

create or replace function public.finalize_seller_payout_v2(p_release_id uuid, p_transfer_id text)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_release public.seller_payout_releases%rowtype; v_order public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_release from public.seller_payout_releases where id = p_release_id for update;
  if not found or (v_release.stripe_transfer_id is not null and v_release.stripe_transfer_id <> p_transfer_id)
    then raise exception using errcode = '22023', message = 'Transfer mismatch.'; end if;
  update public.seller_payout_releases set status = 'transferred',
    stripe_transfer_id = coalesce(stripe_transfer_id,p_transfer_id), transferred_at = coalesce(transferred_at,now())
    where id = p_release_id;
  update public.seller_financial_adjustments a set
    remaining_amount = a.remaining_amount - x.amount,
    status = case when a.remaining_amount = x.amount then 'settled' else 'pending' end,
    reserved_by_release_id = null,
    settled_at = case when a.remaining_amount = x.amount then now() else null end
  from public.seller_payout_adjustment_applications x
  where x.payout_release_id=p_release_id and x.adjustment_id=a.id and x.settled_at is null;
  update public.seller_payout_adjustment_applications set settled_at=now()
    where payout_release_id=p_release_id and settled_at is null;
  update public.orders set transfer_status = 'transferred', fulfillment_status='completed',
    completed_at = coalesce(completed_at,now())
    where id = v_release.order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.fail_seller_payout_v2(p_release_id uuid, p_failure_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode='42501',message='Trusted backend required.'; end if;
  update public.seller_financial_adjustments set status='pending',reserved_by_release_id=null
    where reserved_by_release_id=p_release_id;
  delete from public.seller_payout_adjustment_applications
    where payout_release_id=p_release_id and settled_at is null;
  update public.seller_payout_releases set status='failed',failure_code=left(coalesce(p_failure_code,'FAILED'),100)
    where id=p_release_id and status in ('creating','reconciling');
  update public.orders set transfer_status='failed' where id=(select order_id from public.seller_payout_releases where id=p_release_id);
end;
$$;

create or replace function public.prepare_transfer_reversal_v1(p_refund_id uuid)
returns table(reversal_id uuid, reversal_status text, stripe_reversal_id text,
  reversal_reference text, transfer_id text, amount bigint, currency text)
language plpgsql security definer set search_path = '' as $$
declare v_refund public.order_refunds%rowtype; v_release public.seller_payout_releases%rowtype;
  v_reversal public.transfer_reversals%rowtype; v_prior bigint; v_amount bigint; v_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_refund from public.order_refunds where id = p_refund_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Refund not found.'; end if;
  select * into v_release from public.seller_payout_releases where order_id = v_refund.order_id for update;
  if not found or v_release.status <> 'transferred' or v_release.stripe_transfer_id is null then raise exception using errcode = '55000', message = 'Transferred payout not found.'; end if;
  select coalesce(sum(amount),0) into v_prior from public.transfer_reversals
    where payout_release_id = v_release.id and status in ('creating','reconciling','succeeded');
  v_amount := least(v_refund.amount, v_release.amount - v_prior);
  if v_amount <= 0 then raise exception using errcode = '22003', message = 'Invalid reversal amount.'; end if;
  insert into public.transfer_reversals(id,order_id,payout_release_id,refund_id,amount,currency,status,stripe_transfer_id,reversal_reference)
  values(v_id,v_refund.order_id,v_release.id,v_refund.id,v_amount,v_release.currency,'creating',v_release.stripe_transfer_id,
    'transfer_reversal_' || replace(v_id::text,'-','')) on conflict do nothing returning * into v_reversal;
  if not found then select * into v_reversal from public.transfer_reversals where refund_id=v_refund.id for update; end if;
  update public.orders set transfer_status='on_hold' where id=v_refund.order_id;
  return query select v_reversal.id,v_reversal.status,v_reversal.stripe_reversal_id,v_reversal.reversal_reference,
    v_reversal.stripe_transfer_id,v_reversal.amount,v_reversal.currency;
end;
$$;

create or replace function public.create_refund_liability_v1(p_refund_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_refund public.order_refunds%rowtype; v_order public.orders%rowtype; v_payment public.payments%rowtype;
  v_release public.seller_payout_releases%rowtype; v_reversed bigint; v_liability bigint; v_original bigint;
  v_total_refunds bigint; v_remaining bigint; v_had_release boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception using errcode='42501',message='Trusted backend required.'; end if;
  select * into v_refund from public.order_refunds where id=p_refund_id and status='succeeded' for update;
  if not found then return; end if;
  select * into v_order from public.orders where id=v_refund.order_id for update;
  select * into v_payment from public.payments where id=v_refund.payment_id;
  if v_payment.processing_fee_status <> 'reconciled' or v_payment.actual_processing_fee_amount is null then return; end if;
  select * into v_release from public.seller_payout_releases where order_id=v_refund.order_id;
  v_had_release := found;
  select coalesce(sum(amount),0) into v_reversed from public.transfer_reversals
    where refund_id=v_refund.id and status='succeeded';
  v_original := greatest(0,v_order.item_amount+v_order.shipping_amount-v_order.marketplace_fee_amount
    -coalesce(v_payment.actual_processing_fee_amount,0)-v_order.reserve_withheld_amount);
  select coalesce(sum(amount),0) into v_total_refunds from public.order_refunds
    where order_id=v_order.id and status='succeeded';
  v_remaining := greatest(0,v_original-v_total_refunds);
  if v_refund.amount = v_payment.amount then
    v_liability := coalesce(v_payment.actual_processing_fee_amount,0);
  else
    v_liability := greatest(0,v_refund.amount - case when v_had_release then v_reversed else least(v_refund.amount,v_original) end);
  end if;
  if v_liability > 0 then
    insert into public.seller_financial_adjustments(seller_id,order_id,adjustment_type,amount,remaining_amount,source_ref)
    values(v_order.seller_id,v_order.id,
      case when v_refund.reason='seller_cancellation' then 'seller_cancellation_processing_fee' else 'refund_liability' end,
      v_liability,v_liability,'refund_liability_'||replace(v_refund.id::text,'-','')) on conflict(source_ref) do nothing;
  end if;
  if v_refund.amount < v_payment.amount and not v_had_release
    and not exists (select 1 from public.order_refunds r where r.order_id=v_order.id and r.status in ('pending','creating','reconciling'))
    and not exists (select 1 from public.transfer_reversals r where r.order_id=v_order.id and r.status in ('creating','reconciling'))
    and v_order.fulfillment_status in ('pickup_confirmed','delivered','completed') then
    update public.orders set transfer_status=case when v_remaining > 0 then 'eligible' else 'not_eligible' end,
      seller_transfer_amount=case when v_remaining = 0 then 0 else seller_transfer_amount end
      where id=v_order.id;
  end if;
end;
$$;

revoke all on function public.reconcile_payment_processing_fee_v1(uuid,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.mark_payment_processing_fee_reconciling_v1(uuid) from public,anon,authenticated;
revoke all on function public.create_refund_liability_v1(uuid) from public,anon,authenticated;
grant execute on function public.reconcile_payment_processing_fee_v1(uuid,text,text,bigint,text) to service_role;
grant execute on function public.mark_payment_processing_fee_reconciling_v1(uuid) to service_role;
grant execute on function public.create_refund_liability_v1(uuid) to service_role;

comment on column public.payments.actual_processing_fee_amount is 'Authoritative Stripe BalanceTransaction fee in integer cents.';
comment on column public.payments.stripe_balance_transaction_id is 'Server-only Stripe identifier used for immutable fee reconciliation.';

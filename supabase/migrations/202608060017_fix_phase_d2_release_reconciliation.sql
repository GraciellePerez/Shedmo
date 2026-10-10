-- Phase D2 security fix: durable payout reconciliation and order-bound pickup scans.

alter table public.seller_payout_releases
  drop constraint seller_payout_releases_status_check;
alter table public.seller_payout_releases
  add constraint seller_payout_releases_status_check
  check (status in ('pending', 'creating', 'reconciling', 'transferred', 'failed'));

alter table public.seller_payout_releases
  add column id uuid not null default gen_random_uuid(),
  add column seller_id uuid references public.profiles(id) on delete restrict,
  add column source_charge_id text,
  add column destination_account_id text,
  add column transfer_reference text,
  add column transfer_version smallint not null default 1 check (transfer_version = 1);

update public.seller_payout_releases release
set seller_id = orders.seller_id,
    source_charge_id = payments.stripe_charge_id,
    destination_account_id = accounts.stripe_account_id,
    transfer_reference = 'payout_release_' || replace(release.id::text, '-', '')
from public.orders orders
join public.payments payments on payments.order_id = orders.id
join public.seller_payment_accounts accounts on accounts.user_id = orders.seller_id
where orders.id = release.order_id;

alter table public.seller_payout_releases
  alter column seller_id set not null,
  alter column source_charge_id set not null,
  alter column destination_account_id set not null,
  alter column transfer_reference set not null,
  add constraint seller_payout_releases_id_key unique (id),
  add constraint seller_payout_releases_transfer_reference_key unique (transfer_reference);

revoke all on table public.seller_payout_releases from anon, authenticated;
grant select (
  order_id, amount, currency, status, transferred_at, created_at, updated_at
) on public.seller_payout_releases to authenticated;

create or replace function public.prepare_seller_payout_v2(p_order_id uuid, p_seller_id uuid)
returns table(
  release_id uuid,
  release_status text,
  stripe_transfer_id text,
  transfer_reference text,
  destination_account_id text,
  source_charge_id text,
  amount bigint,
  currency text,
  transfer_version smallint
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_account public.seller_payment_accounts%rowtype;
  v_payment public.payments%rowtype;
  v_release public.seller_payout_releases%rowtype;
  v_amount bigint;
  v_release_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted backend required.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then
    raise exception using errcode = '42501', message = 'Order access denied.';
  end if;
  if v_order.payment_status <> 'succeeded' or v_order.dispute_status <> 'none'
    or v_order.fulfillment_status not in ('pickup_confirmed', 'delivered', 'completed')
    or v_order.transfer_status not in ('eligible', 'pending', 'transferred', 'failed') then
    raise exception using errcode = '55000', message = 'Payout is not eligible.';
  end if;

  select * into v_account from public.seller_payment_accounts where user_id = p_seller_id;
  if not found or v_account.stripe_account_id is null
    or v_account.onboarding_status <> 'enabled' or not v_account.payouts_enabled
    or v_account.transfer_capability_status <> 'active' then
    raise exception using errcode = '55000', message = 'Seller payouts are unavailable.';
  end if;

  select * into v_payment from public.payments where order_id = p_order_id;
  if not found or v_payment.status <> 'succeeded' or v_payment.stripe_charge_id is null then
    raise exception using errcode = '55000', message = 'Payment is not transferable.';
  end if;

  v_amount := v_order.item_amount + v_order.shipping_amount
    - v_order.marketplace_fee_amount - v_order.reserve_withheld_amount;
  if v_amount <= 0 then
    raise exception using errcode = '55000', message = 'Invalid payout amount.';
  end if;

  insert into public.seller_payout_releases (
    id, order_id, seller_id, amount, currency, status, source_charge_id,
    destination_account_id, transfer_reference
  ) values (
    v_release_id, p_order_id, p_seller_id, v_amount, v_order.currency, 'creating',
    v_payment.stripe_charge_id, v_account.stripe_account_id,
    'payout_release_' || replace(v_release_id::text, '-', '')
  ) on conflict (order_id) do nothing;

  select * into v_release from public.seller_payout_releases
  where order_id = p_order_id for update;
  if v_release.seller_id <> p_seller_id or v_release.amount <> v_amount
    or v_release.currency <> v_order.currency
    or v_release.source_charge_id <> v_payment.stripe_charge_id
    or v_release.destination_account_id <> v_account.stripe_account_id then
    raise exception using errcode = '22023', message = 'Payout data mismatch.';
  end if;

  if v_release.status = 'pending' then
    update public.seller_payout_releases set status = 'creating'
    where id = v_release.id returning * into v_release;
  end if;
  if v_release.status not in ('creating', 'reconciling', 'transferred', 'failed') then
    raise exception using errcode = '55000', message = 'Payout state is unavailable.';
  end if;
  if v_release.status not in ('transferred', 'failed') then
    update public.orders set transfer_status = 'pending', seller_transfer_amount = v_amount
    where id = p_order_id;
  end if;

  return query select v_release.id, v_release.status, v_release.stripe_transfer_id,
    v_release.transfer_reference, v_release.destination_account_id,
    v_release.source_charge_id, v_release.amount, v_release.currency,
    v_release.transfer_version;
end;
$$;

create or replace function public.record_seller_transfer_v2(p_release_id uuid, p_transfer_id text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted backend required.';
  end if;
  update public.seller_payout_releases
  set stripe_transfer_id = coalesce(stripe_transfer_id, p_transfer_id),
      status = case when status = 'transferred' then status else 'reconciling' end,
      failure_code = null
  where id = p_release_id
    and (stripe_transfer_id is null or stripe_transfer_id = p_transfer_id)
    and status <> 'failed';
  if not found then
    raise exception using errcode = '22023', message = 'Transfer record mismatch.';
  end if;
end;
$$;

create or replace function public.mark_seller_payout_reconciling_v2(
  p_release_id uuid, p_reason_code text
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted backend required.';
  end if;
  update public.seller_payout_releases
  set status = 'reconciling', failure_code = left(p_reason_code, 100)
  where id = p_release_id and status not in ('transferred', 'failed');
end;
$$;

create or replace function public.finalize_seller_payout_v2(
  p_release_id uuid, p_transfer_id text
)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare
  v_release public.seller_payout_releases%rowtype;
  v_order public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted backend required.';
  end if;
  select * into v_release from public.seller_payout_releases
  where id = p_release_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payout not found.';
  end if;
  if v_release.status = 'failed'
    or (v_release.stripe_transfer_id is not null and v_release.stripe_transfer_id <> p_transfer_id) then
    raise exception using errcode = '22023', message = 'Transfer mismatch.';
  end if;
  update public.seller_payout_releases
  set status = 'transferred', stripe_transfer_id = p_transfer_id,
      transferred_at = coalesce(transferred_at, now()), failure_code = null
  where id = p_release_id;
  update public.orders
  set transfer_status = 'transferred', fulfillment_status = 'completed',
      completed_at = coalesce(completed_at, now())
  where id = v_release.order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.fail_seller_payout_v2(
  p_release_id uuid, p_failure_code text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted backend required.';
  end if;
  update public.seller_payout_releases
  set status = 'failed', failure_code = left(p_failure_code, 100)
  where id = p_release_id and status = 'creating' and stripe_transfer_id is null
  returning order_id into v_order_id;
  if v_order_id is not null then
    update public.orders set transfer_status = 'failed'
    where id = v_order_id and transfer_status <> 'transferred';
  end if;
end;
$$;

create or replace function public.consume_pickup_token_bound_v2(
  p_expected_order_id uuid, p_scanned_order_id uuid, p_seller_id uuid,
  p_buyer_id uuid, p_token text
)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype; v_pickup public.pickup_tokens%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted backend required.';
  end if;
  if p_expected_order_id <> p_scanned_order_id then
    raise exception using errcode = '22023', message = 'QR_ORDER_MISMATCH';
  end if;
  select * into v_order from public.orders where id = p_expected_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then
    raise exception using errcode = '42501', message = 'Order access denied.';
  end if;
  if v_order.buyer_id <> p_buyer_id then
    raise exception using errcode = '22023', message = 'Pickup proof mismatch.';
  end if;
  if v_order.fulfillment_type <> 'pickup' or v_order.payment_status <> 'succeeded'
    or v_order.fulfillment_status <> 'pickup_ready' then
    raise exception using errcode = '55000', message = 'Invalid order state.';
  end if;
  select * into v_pickup from public.pickup_tokens
  where order_id = p_expected_order_id and buyer_id = p_buyer_id
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then
    raise exception using errcode = '22023', message = 'Invalid pickup proof.';
  end if;
  if v_pickup.used_at is not null or v_pickup.expires_at <= now() then
    raise exception using errcode = '55000', message = 'Pickup proof expired or already used.';
  end if;
  update public.pickup_tokens set used_at = now()
  where id = v_pickup.id and used_at is null;
  update public.orders
  set fulfillment_status = 'pickup_confirmed',
      pickup_confirmed_at = coalesce(pickup_confirmed_at, now()),
      transfer_status = 'eligible', payout_eligible_at = coalesce(payout_eligible_at, now())
  where id = p_expected_order_id returning * into v_order;
  return v_order;
end;
$$;

revoke execute on function public.claim_seller_payout(uuid, uuid) from service_role;
revoke execute on function public.consume_pickup_token(uuid, uuid, uuid, text) from service_role;
revoke execute on function public.finalize_seller_payout(uuid, text) from service_role;
revoke execute on function public.fail_seller_payout(uuid, text) from service_role;
revoke all on function public.prepare_seller_payout_v2(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_seller_transfer_v2(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_seller_payout_reconciling_v2(uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_seller_payout_v2(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_seller_payout_v2(uuid, text) from public, anon, authenticated;
revoke all on function public.consume_pickup_token_bound_v2(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_seller_payout_v2(uuid, uuid) to service_role;
grant execute on function public.record_seller_transfer_v2(uuid, text) to service_role;
grant execute on function public.mark_seller_payout_reconciling_v2(uuid, text) to service_role;
grant execute on function public.finalize_seller_payout_v2(uuid, text) to service_role;
grant execute on function public.fail_seller_payout_v2(uuid, text) to service_role;
grant execute on function public.consume_pickup_token_bound_v2(uuid, uuid, uuid, uuid, text) to service_role;

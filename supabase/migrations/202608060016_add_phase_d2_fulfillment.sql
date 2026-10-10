-- Phase D2: fulfillment, one-time pickup proof, shipment tracking, and payout release.
-- All mutations are performed by authenticated Edge Functions through service-role-only RPCs.

create table public.order_shipments (
  order_id uuid primary key references public.orders(id) on delete restrict,
  carrier text not null check (char_length(btrim(carrier)) between 2 and 80),
  tracking_number text not null check (char_length(btrim(tracking_number)) between 3 and 120),
  shipped_at timestamptz not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pickup_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index pickup_tokens_one_live_order_idx
  on public.pickup_tokens (order_id) where used_at is null;
create index pickup_tokens_expiry_idx
  on public.pickup_tokens (expires_at) where used_at is null;

create table public.seller_payout_releases (
  order_id uuid primary key references public.orders(id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'pending'
    check (status in ('pending', 'transferred', 'failed')),
  stripe_transfer_id text unique,
  failure_code text check (failure_code is null or char_length(failure_code) <= 100),
  transferred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_payout_release_transfer_check check (
    (status = 'transferred' and stripe_transfer_id is not null and transferred_at is not null)
    or status <> 'transferred'
  )
);

create trigger order_shipments_set_updated_at before update on public.order_shipments
for each row execute function public.set_payment_foundation_updated_at();
create trigger seller_payout_releases_set_updated_at before update on public.seller_payout_releases
for each row execute function public.set_payment_foundation_updated_at();

alter table public.order_shipments enable row level security;
alter table public.pickup_tokens enable row level security;
alter table public.seller_payout_releases enable row level security;

create policy "Order participants read shipment tracking"
on public.order_shipments for select to authenticated
using (exists (
  select 1 from public.orders o
  where o.id = order_shipments.order_id and auth.uid() in (o.buyer_id, o.seller_id)
));

create policy "Order participants read payout release status"
on public.seller_payout_releases for select to authenticated
using (exists (
  select 1 from public.orders o
  where o.id = seller_payout_releases.order_id and auth.uid() in (o.buyer_id, o.seller_id)
));

revoke all on table public.order_shipments, public.pickup_tokens, public.seller_payout_releases
from anon, authenticated;
grant select on table public.order_shipments, public.seller_payout_releases to authenticated;
grant select, insert, update on table public.order_shipments, public.pickup_tokens, public.seller_payout_releases to service_role;

create or replace function public.issue_pickup_token(p_order_id uuid)
returns table(token text, expires_at timestamptz, buyer_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.buyer_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'Order access denied.';
  end if;
  if v_order.fulfillment_type <> 'pickup' or v_order.payment_status <> 'succeeded'
    or v_order.fulfillment_status not in ('pickup_scheduled', 'pickup_ready') then
    raise exception using errcode = '55000', message = 'Order is not available for pickup.';
  end if;
  update public.pickup_tokens set used_at = now()
  where order_id = p_order_id and used_at is null;
  insert into public.pickup_tokens(order_id, buyer_id, token_hash, expires_at)
  values (p_order_id, auth.uid(), encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires_at);
  return query select v_token, v_expires_at, auth.uid();
end;
$$;
revoke all on function public.issue_pickup_token(uuid) from public, anon, authenticated;
grant execute on function public.issue_pickup_token(uuid) to authenticated;

create or replace function public.mark_order_ready_for_pickup(p_order_id uuid, p_seller_id uuid)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.fulfillment_type <> 'pickup' or v_order.payment_status <> 'succeeded' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  if v_order.fulfillment_status = 'pickup_ready' then return v_order; end if;
  if v_order.fulfillment_status <> 'pickup_scheduled' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  update public.orders set fulfillment_status = 'pickup_ready' where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.consume_pickup_token(
  p_order_id uuid, p_seller_id uuid, p_buyer_id uuid, p_token text
)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype; v_pickup public.pickup_tokens%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.buyer_id <> p_buyer_id then raise exception using errcode = '22023', message = 'Pickup proof mismatch.'; end if;
  if v_order.fulfillment_type <> 'pickup' or v_order.payment_status <> 'succeeded'
    or v_order.fulfillment_status <> 'pickup_ready' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  select * into v_pickup from public.pickup_tokens
  where order_id = p_order_id and buyer_id = p_buyer_id
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then raise exception using errcode = '22023', message = 'Invalid pickup proof.'; end if;
  if v_pickup.used_at is not null or v_pickup.expires_at <= now() then raise exception using errcode = '55000', message = 'Pickup proof expired or already used.'; end if;
  update public.pickup_tokens set used_at = now() where id = v_pickup.id and used_at is null;
  update public.orders set fulfillment_status = 'pickup_confirmed', pickup_confirmed_at = coalesce(pickup_confirmed_at, now()),
    transfer_status = 'eligible', payout_eligible_at = coalesce(payout_eligible_at, now())
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.mark_order_shipped(
  p_order_id uuid, p_seller_id uuid, p_carrier text, p_tracking_number text, p_shipped_at timestamptz
)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  if char_length(btrim(p_carrier)) not between 2 and 80 or char_length(btrim(p_tracking_number)) not between 3 and 120
    or p_shipped_at > now() + interval '5 minutes' then raise exception using errcode = '22023', message = 'Invalid shipment details.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.fulfillment_type <> 'shipping' or v_order.payment_status <> 'succeeded' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  if v_order.fulfillment_status = 'shipped' then return v_order; end if;
  if v_order.fulfillment_status <> 'awaiting_shipment' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  insert into public.order_shipments(order_id, carrier, tracking_number, shipped_at)
  values (p_order_id, btrim(p_carrier), btrim(p_tracking_number), p_shipped_at)
  on conflict (order_id) do nothing;
  update public.orders set fulfillment_status = 'shipped', shipped_at = p_shipped_at where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.mark_order_delivered(p_order_id uuid, p_buyer_id uuid)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.buyer_id <> p_buyer_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.fulfillment_type <> 'shipping' or v_order.payment_status <> 'succeeded' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  if v_order.fulfillment_status = 'delivered' then return v_order; end if;
  if v_order.fulfillment_status <> 'shipped' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  update public.order_shipments set delivered_at = coalesce(delivered_at, now()) where order_id = p_order_id;
  update public.orders set fulfillment_status = 'delivered', delivered_at = coalesce(delivered_at, now()),
    transfer_status = 'eligible', payout_eligible_at = coalesce(payout_eligible_at, now())
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.claim_seller_payout(p_order_id uuid, p_seller_id uuid)
returns table(order_id uuid, seller_account_id text, source_charge_id text, amount bigint, currency text, already_transferred boolean)
language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype; v_account public.seller_payment_accounts%rowtype; v_release public.seller_payout_releases%rowtype; v_payment public.payments%rowtype; v_amount bigint;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.payment_status <> 'succeeded' or v_order.dispute_status <> 'none'
    or v_order.fulfillment_status not in ('pickup_confirmed', 'delivered', 'completed')
    or v_order.transfer_status not in ('eligible', 'pending', 'transferred', 'failed') then raise exception using errcode = '55000', message = 'Payout is not eligible.'; end if;
  select * into v_account from public.seller_payment_accounts where user_id = p_seller_id;
  if not found or v_account.stripe_account_id is null or v_account.onboarding_status <> 'enabled'
    or not v_account.payouts_enabled or v_account.transfer_capability_status <> 'active' then raise exception using errcode = '55000', message = 'Seller payouts are unavailable.'; end if;
  select * into v_payment from public.payments where payments.order_id = p_order_id;
  if not found or v_payment.status <> 'succeeded' or v_payment.stripe_charge_id is null then
    raise exception using errcode = '55000', message = 'Payment is not transferable.';
  end if;
  v_amount := v_order.item_amount + v_order.shipping_amount - v_order.marketplace_fee_amount - v_order.reserve_withheld_amount;
  if v_amount <= 0 then raise exception using errcode = '55000', message = 'Invalid payout amount.'; end if;
  insert into public.seller_payout_releases(order_id, amount, currency)
  values (p_order_id, v_amount, v_order.currency) on conflict (order_id) do nothing;
  select * into v_release from public.seller_payout_releases where seller_payout_releases.order_id = p_order_id;
  if v_release.amount <> v_amount or v_release.currency <> v_order.currency then raise exception using errcode = '22023', message = 'Payout data mismatch.'; end if;
  if v_release.status <> 'transferred' then
    update public.orders set transfer_status = 'pending', seller_transfer_amount = v_amount where id = p_order_id;
  end if;
  return query select p_order_id, v_account.stripe_account_id, v_payment.stripe_charge_id, v_amount, v_order.currency, v_release.status = 'transferred';
end;
$$;

create or replace function public.finalize_seller_payout(p_order_id uuid, p_transfer_id text)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype; v_release public.seller_payout_releases%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_release from public.seller_payout_releases where order_id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_release.status = 'transferred' and v_release.stripe_transfer_id <> p_transfer_id then raise exception using errcode = '22023', message = 'Transfer mismatch.'; end if;
  update public.seller_payout_releases set status = 'transferred', stripe_transfer_id = p_transfer_id,
    transferred_at = coalesce(transferred_at, now()), failure_code = null where order_id = p_order_id;
  update public.orders set transfer_status = 'transferred', fulfillment_status = 'completed',
    completed_at = coalesce(completed_at, now()) where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.fail_seller_payout(p_order_id uuid, p_failure_code text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  update public.seller_payout_releases set status = 'failed', failure_code = left(p_failure_code, 100)
  where order_id = p_order_id and status <> 'transferred';
  update public.orders set transfer_status = 'failed' where id = p_order_id and transfer_status <> 'transferred';
end;
$$;

revoke all on function public.mark_order_ready_for_pickup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.consume_pickup_token(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_order_shipped(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_order_delivered(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_seller_payout(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_seller_payout(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_seller_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_order_ready_for_pickup(uuid, uuid) to service_role;
grant execute on function public.consume_pickup_token(uuid, uuid, uuid, text) to service_role;
grant execute on function public.mark_order_shipped(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.mark_order_delivered(uuid, uuid) to service_role;
grant execute on function public.claim_seller_payout(uuid, uuid) to service_role;
grant execute on function public.finalize_seller_payout(uuid, text) to service_role;
grant execute on function public.fail_seller_payout(uuid, text) to service_role;

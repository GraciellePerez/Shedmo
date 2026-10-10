-- Phase B: secure order and payment database foundation.
--
-- This migration creates no Stripe objects and performs no remote calls. Tax is
-- fixed at zero by the reservation function until marketplace-facilitator tax
-- responsibility is resolved and a later tax phase is implemented. Real-money
-- public launch is blocked until then.

create table public.seller_payment_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_account_id text unique,
  account_type text not null default 'express'
    check (account_type = 'express'),
  onboarding_status text not null default 'created'
    check (onboarding_status in (
      'created', 'onboarding_incomplete', 'details_submitted_pending',
      'enabled', 'restricted', 'disabled'
    )),
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  transfer_capability_status text
    check (transfer_capability_status is null or transfer_capability_status in (
      'inactive', 'pending', 'active', 'restricted'
    )),
  disabled_reason text check (
    disabled_reason is null or char_length(disabled_reason) <= 500
  ),
  risk_tier text not null default 'new'
    check (risk_tier in ('new', 'standard', 'trusted', 'restricted')),
  payout_delay_days integer not null default 7
    check (payout_delay_days between 0 and 90),
  reserve_basis_points integer not null default 0
    check (reserve_basis_points between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_payment_accounts_enabled_state_check check (
    onboarding_status <> 'enabled'
    or (
      stripe_account_id is not null
      and details_submitted
      and payouts_enabled
      and transfer_capability_status = 'active'
    )
  )
);

-- A listing must have an explicit reserved state so it disappears from active
-- inventory inside the same transaction that creates its order.
alter table public.listings
  drop constraint if exists listings_status_check;

alter table public.listings
  add constraint listings_status_check
  check (status in ('draft', 'active', 'reserved', 'sold', 'expired', 'archived'));

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  client_checkout_key uuid not null unique,
  fulfillment_type text not null
    check (fulfillment_type in ('pickup', 'shipping')),
  payment_status text not null default 'none'
    check (payment_status in (
      'none', 'pending', 'processing', 'succeeded', 'failed', 'canceled',
      'refund_pending', 'partially_refunded', 'refunded', 'disputed'
    )),
  fulfillment_status text not null default 'reserved'
    check (fulfillment_status in (
      'reserved', 'awaiting_payment', 'paid', 'pickup_scheduled',
      'pickup_ready', 'pickup_confirmed', 'awaiting_shipment', 'shipped',
      'delivered', 'inspection_window', 'completed', 'canceled'
    )),
  dispute_status text not null default 'none'
    check (dispute_status in (
      'none', 'open', 'awaiting_buyer_evidence', 'awaiting_seller_response',
      'under_review', 'resolved_buyer', 'resolved_seller',
      'closed_no_action', 'external_chargeback'
    )),
  transfer_status text not null default 'not_eligible'
    check (transfer_status in (
      'not_eligible', 'on_hold', 'eligible', 'pending', 'transferred',
      'partially_reversed', 'reversed', 'failed'
    )),
  item_amount bigint not null check (item_amount between 0 and 500000),
  shipping_amount bigint not null check (shipping_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  marketplace_fee_amount bigint not null check (
    marketplace_fee_amount >= 0 and marketplace_fee_amount <= item_amount
  ),
  estimated_processing_amount bigint
    check (estimated_processing_amount is null or estimated_processing_amount >= 0),
  actual_processing_amount bigint
    check (actual_processing_amount is null or actual_processing_amount >= 0),
  reserve_withheld_amount bigint not null default 0
    check (reserve_withheld_amount >= 0),
  seller_transfer_amount bigint
    check (seller_transfer_amount is null or seller_transfer_amount >= 0),
  total_amount bigint not null check (
    total_amount >= 0
    and total_amount = item_amount + shipping_amount + tax_amount
  ),
  currency text not null default 'usd' check (currency = 'usd'),
  listing_title_snapshot text not null
    check (char_length(btrim(listing_title_snapshot)) between 3 and 120),
  listing_condition_snapshot text,
  listing_category_snapshot text,
  listing_image_snapshot text,
  reservation_expires_at timestamptz,
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  pickup_confirmed_at timestamptz,
  inspection_expires_at timestamptz,
  payout_eligible_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_distinct_participants_check check (buyer_id <> seller_id),
  constraint orders_reservation_expiration_check check (
    fulfillment_status not in ('reserved', 'awaiting_payment')
    or reservation_expires_at is not null
  )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  stripe_payment_intent_id text unique,
  stripe_charge_id text unique,
  status text not null default 'pending'
    check (status in (
      'pending', 'processing', 'succeeded', 'failed', 'canceled',
      'refund_pending', 'partially_refunded', 'refunded', 'disputed'
    )),
  amount bigint not null check (amount >= 0),
  currency text not null default 'usd' check (currency = 'usd'),
  failure_code text check (failure_code is null or char_length(failure_code) <= 100),
  refunded_amount bigint not null default 0
    check (refunded_amount >= 0 and refunded_amount <= amount),
  dispute_status text check (
    dispute_status is null or dispute_status in (
      'none', 'warning_needs_response', 'warning_under_review',
      'warning_closed', 'needs_response', 'under_review', 'won', 'lost'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null check (char_length(event_type) between 1 and 160),
  api_version text check (api_version is null or char_length(api_version) <= 80),
  object_id text check (object_id is null or char_length(object_id) <= 255),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'processed', 'failed', 'ignored')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 1000),
  processed_at timestamptz,
  last_error_code text check (
    last_error_code is null or char_length(last_error_code) <= 100
  ),
  last_error_message text check (
    last_error_message is null or char_length(last_error_message) <= 500
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  prior_payment_status text check (
    prior_payment_status is null or prior_payment_status in (
      'none', 'pending', 'processing', 'succeeded', 'failed', 'canceled',
      'refund_pending', 'partially_refunded', 'refunded', 'disputed'
    )
  ),
  new_payment_status text check (
    new_payment_status is null or new_payment_status in (
      'none', 'pending', 'processing', 'succeeded', 'failed', 'canceled',
      'refund_pending', 'partially_refunded', 'refunded', 'disputed'
    )
  ),
  prior_fulfillment_status text check (
    prior_fulfillment_status is null or prior_fulfillment_status in (
      'reserved', 'awaiting_payment', 'paid', 'pickup_scheduled',
      'pickup_ready', 'pickup_confirmed', 'awaiting_shipment', 'shipped',
      'delivered', 'inspection_window', 'completed', 'canceled'
    )
  ),
  new_fulfillment_status text check (
    new_fulfillment_status is null or new_fulfillment_status in (
      'reserved', 'awaiting_payment', 'paid', 'pickup_scheduled',
      'pickup_ready', 'pickup_confirmed', 'awaiting_shipment', 'shipped',
      'delivered', 'inspection_window', 'completed', 'canceled'
    )
  ),
  prior_dispute_status text check (
    prior_dispute_status is null or prior_dispute_status in (
      'none', 'open', 'awaiting_buyer_evidence', 'awaiting_seller_response',
      'under_review', 'resolved_buyer', 'resolved_seller',
      'closed_no_action', 'external_chargeback'
    )
  ),
  new_dispute_status text check (
    new_dispute_status is null or new_dispute_status in (
      'none', 'open', 'awaiting_buyer_evidence', 'awaiting_seller_response',
      'under_review', 'resolved_buyer', 'resolved_seller',
      'closed_no_action', 'external_chargeback'
    )
  ),
  prior_transfer_status text check (
    prior_transfer_status is null or prior_transfer_status in (
      'not_eligible', 'on_hold', 'eligible', 'pending', 'transferred',
      'partially_reversed', 'reversed', 'failed'
    )
  ),
  new_transfer_status text check (
    new_transfer_status is null or new_transfer_status in (
      'not_eligible', 'on_hold', 'eligible', 'pending', 'transferred',
      'partially_reversed', 'reversed', 'failed'
    )
  ),
  actor_type text not null
    check (actor_type in ('buyer', 'seller', 'service', 'system')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason_code text check (reason_code is null or char_length(reason_code) <= 100),
  created_at timestamptz not null default now()
);

comment on column public.orders.tax_amount is
  'Fixed to zero by the Phase B reservation RPC. Real-money public launch is blocked until tax responsibility and calculation are implemented.';
comment on column public.orders.estimated_processing_amount is
  'Display estimate only; never authoritative for the later seller transfer.';
comment on column public.orders.actual_processing_amount is
  'Future trusted backend value sourced from the Stripe balance transaction.';
comment on column public.stripe_webhook_events.last_error_message is
  'Sanitized operational metadata only; never store secrets, raw payloads, payment details, or customer data.';

create index seller_payment_accounts_status_idx
  on public.seller_payment_accounts (onboarding_status, transfer_capability_status);
create index orders_buyer_created_idx
  on public.orders (buyer_id, created_at desc, id desc);
create index orders_seller_created_idx
  on public.orders (seller_id, created_at desc, id desc);
create unique index orders_one_live_per_listing_idx
  on public.orders (listing_id)
  where fulfillment_status not in ('completed', 'canceled');
create index orders_reservation_expiration_idx
  on public.orders (reservation_expires_at)
  where fulfillment_status in ('reserved', 'awaiting_payment');
create index payments_status_updated_idx
  on public.payments (status, updated_at);
create index stripe_webhook_events_processing_idx
  on public.stripe_webhook_events (processing_status, created_at);
create index order_status_history_order_created_idx
  on public.order_status_history (order_id, created_at, id);

create or replace function public.set_payment_foundation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger seller_payment_accounts_set_updated_at
before update on public.seller_payment_accounts
for each row execute function public.set_payment_foundation_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_payment_foundation_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_payment_foundation_updated_at();

create trigger stripe_webhook_events_set_updated_at
before update on public.stripe_webhook_events
for each row execute function public.set_payment_foundation_updated_at();

create or replace function public.append_order_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_type text;
begin
  if auth.role() = 'service_role' then
    v_actor_type := 'service';
    v_actor_id := null;
  elsif v_actor_id = new.buyer_id then
    v_actor_type := 'buyer';
  elsif v_actor_id = new.seller_id then
    v_actor_type := 'seller';
  else
    v_actor_type := 'system';
    v_actor_id := null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.order_status_history (
      order_id,
      new_payment_status,
      new_fulfillment_status,
      new_dispute_status,
      new_transfer_status,
      actor_type,
      actor_user_id
    ) values (
      new.id,
      new.payment_status,
      new.fulfillment_status,
      new.dispute_status,
      new.transfer_status,
      v_actor_type,
      v_actor_id
    );
  elsif old.payment_status is distinct from new.payment_status
    or old.fulfillment_status is distinct from new.fulfillment_status
    or old.dispute_status is distinct from new.dispute_status
    or old.transfer_status is distinct from new.transfer_status
  then
    insert into public.order_status_history (
      order_id,
      prior_payment_status,
      new_payment_status,
      prior_fulfillment_status,
      new_fulfillment_status,
      prior_dispute_status,
      new_dispute_status,
      prior_transfer_status,
      new_transfer_status,
      actor_type,
      actor_user_id
    ) values (
      new.id,
      old.payment_status,
      new.payment_status,
      old.fulfillment_status,
      new.fulfillment_status,
      old.dispute_status,
      new.dispute_status,
      old.transfer_status,
      new.transfer_status,
      v_actor_type,
      v_actor_id
    );
  end if;

  return new;
end;
$$;

create trigger orders_append_status_history
after insert or update of payment_status, fulfillment_status, dispute_status, transfer_status
on public.orders
for each row execute function public.append_order_status_history();

create or replace function public.protect_financially_referenced_listing()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_listing_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  -- Trusted backend workflows may perform controlled state transitions. Normal
  -- seller mutations remain protected by this trigger even though sellers own
  -- the listing row under the pre-existing RLS policy.
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if exists (
    select 1
    from public.orders o
    where o.listing_id = v_listing_id
      and o.fulfillment_status not in ('completed', 'canceled')
  ) then
    raise exception using
      errcode = '55000',
      message = 'Listing cannot be changed while an order is reserved or in progress.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger listings_protect_financial_reference
before update or delete on public.listings
for each row execute function public.protect_financially_referenced_listing();

create or replace function public.calculate_marketplace_fee_cents(
  p_item_amount bigint
)
returns bigint
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_fee_numerator numeric;
  v_fee bigint;
begin
  if p_item_amount < 0 then
    raise exception using
      errcode = '22003',
      message = 'Item amount cannot be negative.';
  end if;

  if p_item_amount = 0 then
    return 0;
  end if;

  -- Rates are represented as whole percentage points over integer cents. Adding
  -- 50 before division by 100 implements round-half-up to the nearest cent on
  -- the combined tiered fee. numeric prevents bigint multiplication overflow.
  v_fee_numerator := least(p_item_amount, 100000)::numeric * 4
    + greatest(p_item_amount - 100000, 0)::numeric * 2;
  v_fee := floor((v_fee_numerator + 50) / 100)::bigint;

  return greatest(v_fee, 100);
end;
$$;

create or replace function public.reserve_listing_for_checkout(
  p_listing_id uuid,
  p_fulfillment_type text,
  p_client_checkout_key uuid
)
returns table (
  order_id uuid,
  item_amount bigint,
  shipping_amount bigint,
  marketplace_fee_amount bigint,
  total_before_tax bigint,
  reservation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_seller_account public.seller_payment_accounts%rowtype;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_item_amount bigint;
  v_shipping_amount bigint;
  v_marketplace_fee bigint;
  v_listing_image text;
begin
  if auth.role() <> 'authenticated' or v_buyer_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_listing_id is null or p_client_checkout_key is null then
    raise exception using errcode = '22004', message = 'Listing and checkout key are required.';
  end if;
  if p_fulfillment_type not in ('pickup', 'shipping') then
    raise exception using errcode = '22023', message = 'Unsupported fulfillment type.';
  end if;

  -- Return the original result for a retried checkout request without creating
  -- another order. A checkout key cannot be reused for different parameters.
  select * into v_existing
  from public.orders o
  where o.client_checkout_key = p_client_checkout_key;

  if found then
    if v_existing.buyer_id <> v_buyer_id
      or v_existing.listing_id <> p_listing_id
      or v_existing.fulfillment_type <> p_fulfillment_type
    then
      raise exception using errcode = '22023', message = 'Checkout key parameter mismatch.';
    end if;

    return query select
      v_existing.id,
      v_existing.item_amount,
      v_existing.shipping_amount,
      v_existing.marketplace_fee_amount,
      v_existing.item_amount + v_existing.shipping_amount,
      v_existing.reservation_expires_at;
    return;
  end if;

  select * into v_listing
  from public.listings l
  where l.id = p_listing_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Listing not found.';
  end if;

  -- A concurrent retry can wait on the listing lock. Recheck idempotency after
  -- acquiring it so the retry receives the first transaction's order.
  select * into v_existing
  from public.orders o
  where o.client_checkout_key = p_client_checkout_key;

  if found then
    if v_existing.buyer_id <> v_buyer_id
      or v_existing.listing_id <> p_listing_id
      or v_existing.fulfillment_type <> p_fulfillment_type
    then
      raise exception using errcode = '22023', message = 'Checkout key parameter mismatch.';
    end if;

    return query select
      v_existing.id,
      v_existing.item_amount,
      v_existing.shipping_amount,
      v_existing.marketplace_fee_amount,
      v_existing.item_amount + v_existing.shipping_amount,
      v_existing.reservation_expires_at;
    return;
  end if;

  if v_listing.status <> 'active' then
    raise exception using errcode = '55000', message = 'Listing is not available.';
  end if;
  if v_listing.seller_id = v_buyer_id then
    raise exception using errcode = '42501', message = 'Sellers cannot purchase their own listing.';
  end if;
  if p_fulfillment_type = 'pickup' and not v_listing.pickup_available then
    raise exception using errcode = '22023', message = 'Local pickup is not available.';
  end if;
  if p_fulfillment_type = 'shipping' and not v_listing.shipping_available then
    raise exception using errcode = '22023', message = 'Shipping is not available.';
  end if;

  select * into v_seller_account
  from public.seller_payment_accounts spa
  where spa.user_id = v_listing.seller_id;

  if not found
    or v_seller_account.stripe_account_id is null
    or v_seller_account.onboarding_status <> 'enabled'
    or not v_seller_account.details_submitted
    or not v_seller_account.payouts_enabled
    or v_seller_account.transfer_capability_status <> 'active'
  then
    raise exception using errcode = '55000', message = 'Seller payment onboarding is incomplete.';
  end if;

  v_item_amount := round(v_listing.price * 100)::bigint;
  if v_item_amount <= 0 then
    raise exception using errcode = '22023', message = 'Paid checkout requires a positive item price.';
  end if;
  if v_item_amount > 500000 then
    raise exception using errcode = '22023', message = 'Item exceeds the transaction limit.';
  end if;
  if v_seller_account.risk_tier = 'restricted' then
    raise exception using errcode = '55000', message = 'Seller account requires review.';
  end if;
  if v_seller_account.risk_tier = 'new' and v_item_amount > 100000 then
    raise exception using errcode = '55000', message = 'Transaction requires manual review.';
  end if;

  v_shipping_amount := case
    when p_fulfillment_type = 'shipping'
      then round(coalesce(v_listing.shipping_price, 0) * 100)::bigint
    else 0
  end;
  v_marketplace_fee := public.calculate_marketplace_fee_cents(v_item_amount);

  select li.storage_path into v_listing_image
  from public.listing_images li
  where li.listing_id = v_listing.id
  order by li.sort_order, li.id
  limit 1;

  -- This update occurs before the order insert so the existing owner-mutation
  -- guard sees no in-progress order yet. Any later failure rolls both back.
  update public.listings
  set status = 'reserved'
  where id = v_listing.id;

  insert into public.orders (
    buyer_id,
    seller_id,
    listing_id,
    client_checkout_key,
    fulfillment_type,
    payment_status,
    fulfillment_status,
    dispute_status,
    transfer_status,
    item_amount,
    shipping_amount,
    tax_amount,
    marketplace_fee_amount,
    total_amount,
    currency,
    listing_title_snapshot,
    listing_condition_snapshot,
    listing_category_snapshot,
    listing_image_snapshot,
    reservation_expires_at
  ) values (
    v_buyer_id,
    v_listing.seller_id,
    v_listing.id,
    p_client_checkout_key,
    p_fulfillment_type,
    'none',
    'reserved',
    'none',
    'not_eligible',
    v_item_amount,
    v_shipping_amount,
    0,
    v_marketplace_fee,
    v_item_amount + v_shipping_amount,
    'usd',
    v_listing.title,
    v_listing.condition,
    v_listing.category,
    v_listing_image,
    now() + interval '10 minutes'
  ) returning * into v_order;

  return query select
    v_order.id,
    v_order.item_amount,
    v_order.shipping_amount,
    v_order.marketplace_fee_amount,
    v_order.item_amount + v_order.shipping_amount,
    v_order.reservation_expires_at;
end;
$$;

alter table public.seller_payment_accounts enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.order_status_history enable row level security;

create policy "Users read their safe seller payment status"
on public.seller_payment_accounts for select to authenticated
using (user_id = auth.uid());

create policy "Order participants read their orders"
on public.orders for select to authenticated
using (buyer_id = auth.uid() or seller_id = auth.uid());

create policy "Order participants read safe payment status"
on public.payments for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  )
);

create policy "Order participants read status history"
on public.order_status_history for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  )
);

-- Start from deny-by-default privileges. The service role bypasses RLS and is
-- managed by trusted future Edge Functions; normal clients receive read-only,
-- column-scoped access where Stripe identifiers are intentionally excluded.
revoke all on table public.seller_payment_accounts from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.stripe_webhook_events from anon, authenticated;
revoke all on table public.order_status_history from anon, authenticated;
revoke all on sequence public.order_status_history_id_seq from anon, authenticated;

grant select (
  user_id,
  account_type,
  onboarding_status,
  details_submitted,
  charges_enabled,
  payouts_enabled,
  transfer_capability_status,
  disabled_reason,
  risk_tier,
  payout_delay_days,
  reserve_basis_points,
  created_at,
  updated_at
) on public.seller_payment_accounts to authenticated;

grant select on table public.orders to authenticated;

grant select (
  id,
  order_id,
  status,
  amount,
  currency,
  failure_code,
  refunded_amount,
  dispute_status,
  created_at,
  updated_at
) on public.payments to authenticated;

grant select on table public.order_status_history to authenticated;

revoke all on function public.set_payment_foundation_updated_at() from public, anon, authenticated;
revoke all on function public.append_order_status_history() from public, anon, authenticated;
revoke all on function public.protect_financially_referenced_listing() from public, anon, authenticated;
revoke all on function public.calculate_marketplace_fee_cents(bigint) from public, anon, authenticated;
revoke all on function public.reserve_listing_for_checkout(uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.reserve_listing_for_checkout(uuid, text, uuid) to authenticated;

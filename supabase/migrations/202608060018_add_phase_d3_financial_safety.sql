-- Phase D3: inspection windows, risk-based payout holds, backup pickup PIN,
-- cancellations, refunds, disputes, reversals, and scheduled reconciliation.
-- Stripe processing costs are intentionally borne by the platform for V1.

alter table public.orders
  add column payout_not_before timestamptz,
  add column cancellation_reason text check (cancellation_reason is null or cancellation_reason in (
    'buyer_requested', 'seller_cancelled', 'platform_cancelled',
    'payment_failed', 'reservation_expired'
  )),
  add column refund_status text not null default 'none' check (refund_status in (
    'none', 'pending', 'reconciling', 'partially_refunded', 'refunded', 'failed'
  ));

alter table public.pickup_tokens
  add column pin_hash text,
  add column failed_pin_attempts integer not null default 0
    check (failed_pin_attempts between 0 and 10),
  add column pin_locked_at timestamptz;

create unique index pickup_tokens_pin_hash_idx on public.pickup_tokens (pin_hash)
where pin_hash is not null;

create table public.order_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  dispute_type text not null check (dispute_type in (
    'item_not_received', 'materially_not_as_described', 'stripe_chargeback'
  )),
  status text not null default 'open' check (status in (
    'open', 'awaiting_seller_response', 'under_review',
    'resolved_buyer', 'resolved_seller', 'closed_no_action'
  )),
  stripe_dispute_id text unique,
  buyer_explanation text check (
    buyer_explanation is null or char_length(btrim(buyer_explanation)) between 20 and 4000
  ),
  evidence_paths text[] not null default '{}',
  seller_response text check (
    seller_response is null or char_length(btrim(seller_response)) between 20 and 4000
  ),
  resolution text check (resolution is null or char_length(resolution) <= 1000),
  inspection_deadline timestamptz,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_disputes_participants_check check (buyer_id <> seller_id)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispute-evidence', 'dispute-evidence', false, 8388608,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

create policy "Buyer uploads own dispute evidence" on storage.objects
for insert to authenticated with check (
  bucket_id = 'dispute-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.orders o
    where o.id::text = (storage.foldername(name))[2] and o.buyer_id = auth.uid()
  )
);
create policy "Order participants read dispute evidence" on storage.objects
for select to authenticated using (
  bucket_id = 'dispute-evidence'
  and exists (
    select 1 from public.orders o
    where o.id::text = (storage.foldername(name))[2]
      and auth.uid() in (o.buyer_id, o.seller_id)
  )
);

create unique index order_disputes_one_open_order_idx on public.order_disputes (order_id)
where status in ('open', 'awaiting_seller_response', 'under_review');
create index order_disputes_review_idx on public.order_disputes (status, opened_at);

create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  reason text not null check (reason in (
    'buyer_cancellation', 'seller_cancellation', 'platform_cancellation',
    'dispute_resolved_buyer', 'stripe_chargeback', 'manual_adjustment'
  )),
  status text not null default 'pending' check (status in (
    'pending', 'creating', 'reconciling', 'succeeded', 'failed', 'canceled'
  )),
  stripe_payment_intent_id text not null,
  stripe_refund_id text unique,
  refund_reference text not null unique,
  failure_code text check (failure_code is null or char_length(failure_code) <= 100),
  requested_by uuid references public.profiles(id) on delete set null,
  succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index order_refunds_order_idx on public.order_refunds (order_id, created_at);
create unique index order_refunds_one_cancellation_idx on public.order_refunds (order_id)
where reason in ('buyer_cancellation','seller_cancellation','platform_cancellation');
create index order_refunds_reconcile_idx on public.order_refunds (status, updated_at)
where status in ('creating', 'reconciling');

create table public.transfer_reversals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payout_release_id uuid not null references public.seller_payout_releases(id) on delete restrict,
  refund_id uuid references public.order_refunds(id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'pending' check (status in (
    'pending', 'creating', 'reconciling', 'succeeded', 'failed'
  )),
  stripe_transfer_id text not null,
  stripe_reversal_id text unique,
  reversal_reference text not null unique,
  failure_code text check (failure_code is null or char_length(failure_code) <= 100),
  succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transfer_reversals_order_idx on public.transfer_reversals (order_id, created_at);
create index transfer_reversals_reconcile_idx on public.transfer_reversals (status, updated_at)
where status in ('creating', 'reconciling');

create trigger order_disputes_set_updated_at before update on public.order_disputes
for each row execute function public.set_payment_foundation_updated_at();
create trigger order_refunds_set_updated_at before update on public.order_refunds
for each row execute function public.set_payment_foundation_updated_at();
create trigger transfer_reversals_set_updated_at before update on public.transfer_reversals
for each row execute function public.set_payment_foundation_updated_at();

alter table public.order_disputes enable row level security;
alter table public.order_refunds enable row level security;
alter table public.transfer_reversals enable row level security;

create policy "Participants read their disputes" on public.order_disputes
for select to authenticated using (auth.uid() in (buyer_id, seller_id));
create policy "Participants read refund status" on public.order_refunds
for select to authenticated using (exists (
  select 1 from public.orders o where o.id = order_refunds.order_id
    and auth.uid() in (o.buyer_id, o.seller_id)
));
create policy "Participants read reversal status" on public.transfer_reversals
for select to authenticated using (exists (
  select 1 from public.orders o where o.id = transfer_reversals.order_id
    and auth.uid() in (o.buyer_id, o.seller_id)
));

revoke all on table public.order_disputes, public.order_refunds, public.transfer_reversals
from anon, authenticated;
grant select (
  id, order_id, buyer_id, seller_id, dispute_type, status, buyer_explanation,
  evidence_paths, seller_response, resolution, inspection_deadline, opened_at,
  resolved_at, created_at, updated_at
) on public.order_disputes to authenticated;
grant select (
  id, order_id, amount, currency, reason, status, succeeded_at, created_at, updated_at
) on public.order_refunds to authenticated;
grant select (
  id, order_id, amount, currency, status, succeeded_at, created_at, updated_at
) on public.transfer_reversals to authenticated;
grant select, insert, update on table public.order_disputes, public.order_refunds,
  public.transfer_reversals to service_role;

create or replace function public.phase_d3_payout_not_before(
  p_seller_id uuid, p_eligible_at timestamptz
)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_account public.seller_payment_accounts%rowtype;
begin
  select * into v_account from public.seller_payment_accounts where user_id = p_seller_id;
  if not found or v_account.risk_tier = 'restricted' then return null; end if;
  return p_eligible_at + make_interval(days => v_account.payout_delay_days);
end;
$$;

create or replace function public.phase_d3_make_order_eligible(p_order_id uuid)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_eligible_at timestamptz := now(); v_not_before timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted backend required.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Order not found.'; end if;
  v_not_before := public.phase_d3_payout_not_before(v_order.seller_id, v_eligible_at);
  update public.orders set
    payout_eligible_at = coalesce(payout_eligible_at, v_eligible_at),
    payout_not_before = coalesce(payout_not_before, v_not_before),
    transfer_status = case when v_not_before is null then 'on_hold' else 'eligible' end
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.issue_pickup_proof(p_order_id uuid)
returns table(token text, pin text, expires_at timestamptz, buyer_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_pin text;
  v_pin_bytes bytea;
  v_pin_value integer;
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then
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
  loop
    v_pin_bytes := extensions.gen_random_bytes(3);
    v_pin_value := get_byte(v_pin_bytes, 0) * 65536
      + get_byte(v_pin_bytes, 1) * 256 + get_byte(v_pin_bytes, 2);
    exit when v_pin_value < 16000000;
  end loop;
  v_pin := lpad((v_pin_value % 1000000)::text, 6, '0');
  update public.pickup_tokens set used_at = now()
  where order_id = p_order_id and used_at is null;
  insert into public.pickup_tokens(order_id, buyer_id, token_hash, pin_hash, expires_at)
  values (
    p_order_id, auth.uid(), encode(extensions.digest(v_token, 'sha256'), 'hex'),
    encode(extensions.digest(v_pin, 'sha256'), 'hex'), v_expires_at
  );
  return query select v_token, v_pin, v_expires_at, auth.uid();
end;
$$;

create or replace function public.consume_pickup_token_bound_v2(
  p_expected_order_id uuid, p_scanned_order_id uuid, p_seller_id uuid,
  p_buyer_id uuid, p_token text
)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_pickup public.pickup_tokens%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  if p_expected_order_id <> p_scanned_order_id then raise exception using errcode = '22023', message = 'QR_ORDER_MISMATCH'; end if;
  select * into v_order from public.orders where id = p_expected_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.buyer_id <> p_buyer_id then raise exception using errcode = '22023', message = 'Pickup proof mismatch.'; end if;
  if v_order.fulfillment_type <> 'pickup' or v_order.payment_status <> 'succeeded'
    or v_order.fulfillment_status <> 'pickup_ready' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  select * into v_pickup from public.pickup_tokens
  where order_id = p_expected_order_id and buyer_id = p_buyer_id
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then raise exception using errcode = '22023', message = 'Invalid pickup proof.'; end if;
  if v_pickup.used_at is not null or v_pickup.expires_at <= now() then
    raise exception using errcode = '55000', message = 'Pickup proof expired or already used.';
  end if;
  update public.pickup_tokens set used_at = now() where id = v_pickup.id and used_at is null;
  update public.orders set fulfillment_status = 'pickup_confirmed',
    pickup_confirmed_at = coalesce(pickup_confirmed_at, now()), transfer_status = 'on_hold'
  where id = p_expected_order_id returning * into v_order;
  return public.phase_d3_make_order_eligible(v_order.id);
end;
$$;

create or replace function public.consume_pickup_pin_v1(
  p_order_id uuid, p_seller_id uuid, p_pin text
)
returns table(order_id uuid, result text)
language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_pickup public.pickup_tokens%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception using errcode = '22023', message = 'Invalid pickup PIN.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.fulfillment_type <> 'pickup' or v_order.payment_status <> 'succeeded'
    or v_order.fulfillment_status <> 'pickup_ready' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  select * into v_pickup from public.pickup_tokens
  where order_id = p_order_id and buyer_id = v_order.buyer_id and used_at is null for update;
  if not found or v_pickup.expires_at <= now() then
    return query select p_order_id, 'expired'::text; return;
  end if;
  if v_pickup.pin_locked_at is not null or v_pickup.failed_pin_attempts >= 5 then
    return query select p_order_id, 'locked'::text; return;
  end if;
  if v_pickup.pin_hash is null or v_pickup.pin_hash <> encode(extensions.digest(p_pin, 'sha256'), 'hex') then
    update public.pickup_tokens set failed_pin_attempts = least(failed_pin_attempts + 1, 10),
      pin_locked_at = case when failed_pin_attempts + 1 >= 5 then now() else pin_locked_at end
    where id = v_pickup.id;
    return query select p_order_id, 'invalid'::text; return;
  end if;
  update public.pickup_tokens set used_at = now() where id = v_pickup.id and used_at is null;
  update public.orders set fulfillment_status = 'pickup_confirmed',
    pickup_confirmed_at = coalesce(pickup_confirmed_at, now()), transfer_status = 'on_hold'
  where id = p_order_id;
  perform public.phase_d3_make_order_eligible(p_order_id);
  return query select p_order_id, 'completed'::text;
end;
$$;

create or replace function public.mark_order_delivered(p_order_id uuid, p_buyer_id uuid)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_delivered_at timestamptz := now();
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.buyer_id <> p_buyer_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.fulfillment_status = 'inspection_window' then return v_order; end if;
  if v_order.fulfillment_type <> 'shipping' or v_order.payment_status <> 'succeeded'
    or v_order.fulfillment_status <> 'shipped' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  update public.order_shipments set delivered_at = coalesce(delivered_at, v_delivered_at) where order_id = p_order_id;
  update public.orders set fulfillment_status = 'inspection_window',
    delivered_at = coalesce(delivered_at, v_delivered_at),
    inspection_expires_at = coalesce(inspection_expires_at, v_delivered_at + interval '48 hours'),
    transfer_status = 'on_hold'
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.mark_order_shipped(
  p_order_id uuid, p_seller_id uuid, p_carrier text,
  p_tracking_number text, p_shipped_at timestamptz
)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_carrier text := upper(btrim(p_carrier));
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  if v_carrier not in ('USPS','UPS','FEDEX')
    or char_length(btrim(p_tracking_number)) not between 3 and 120
    or p_shipped_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Invalid shipment details.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.fulfillment_type <> 'shipping' or v_order.payment_status <> 'succeeded' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  if v_order.fulfillment_status = 'shipped' then return v_order; end if;
  if v_order.fulfillment_status <> 'awaiting_shipment' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  insert into public.order_shipments(order_id, carrier, tracking_number, shipped_at)
  values (p_order_id, v_carrier, btrim(p_tracking_number), p_shipped_at)
  on conflict (order_id) do nothing;
  update public.orders set fulfillment_status = 'shipped', shipped_at = p_shipped_at
  where id = p_order_id returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.accept_order_delivery_v1(p_order_id uuid, p_buyer_id uuid)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.buyer_id <> p_buyer_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.fulfillment_status <> 'inspection_window' or v_order.dispute_status <> 'none'
    or v_order.payment_status <> 'succeeded' then raise exception using errcode = '55000', message = 'Invalid order state.'; end if;
  update public.orders set fulfillment_status = 'delivered', transfer_status = 'on_hold'
  where id = p_order_id;
  return public.phase_d3_make_order_eligible(p_order_id);
end;
$$;

create or replace function public.expire_order_inspections_v1(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  for v_id in select id from public.orders where fulfillment_status = 'inspection_window'
    and inspection_expires_at <= now() and dispute_status = 'none'
    order by inspection_expires_at for update skip locked limit least(greatest(p_limit, 1), 500)
  loop
    update public.orders set fulfillment_status = 'delivered', transfer_status = 'on_hold' where id = v_id;
    perform public.phase_d3_make_order_eligible(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.open_order_dispute_v1(
  p_order_id uuid, p_buyer_id uuid, p_type text, p_explanation text, p_evidence_paths text[]
)
returns public.order_disputes language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_dispute public.order_disputes%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  if p_type not in ('item_not_received', 'materially_not_as_described')
    or char_length(btrim(p_explanation)) not between 20 and 4000
    or coalesce(array_length(p_evidence_paths, 1), 0) > 8
    or exists (select 1 from unnest(coalesce(p_evidence_paths, '{}')) evidence_path
      where split_part(evidence_path, '/', 1) <> p_buyer_id::text
        or split_part(evidence_path, '/', 2) <> p_order_id::text) then
    raise exception using errcode = '22023', message = 'Invalid dispute details.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.buyer_id <> p_buyer_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if p_type = 'materially_not_as_described' and (
    v_order.fulfillment_type <> 'shipping' or v_order.fulfillment_status <> 'inspection_window'
    or v_order.inspection_expires_at <= now()
  ) then raise exception using errcode = '55000', message = 'Inspection dispute window is closed.'; end if;
  if v_order.payment_status <> 'succeeded' or v_order.fulfillment_status in ('canceled', 'completed') then
    raise exception using errcode = '55000', message = 'Dispute is not available.';
  end if;
  insert into public.order_disputes(order_id, buyer_id, seller_id, dispute_type,
    status, buyer_explanation, evidence_paths, inspection_deadline)
  values (p_order_id, p_buyer_id, v_order.seller_id, p_type,
    'awaiting_seller_response', btrim(p_explanation), coalesce(p_evidence_paths, '{}'),
    v_order.inspection_expires_at) returning * into v_dispute;
  update public.orders set dispute_status = 'awaiting_seller_response', transfer_status = 'on_hold'
  where id = p_order_id;
  return v_dispute;
end;
$$;

create or replace function public.respond_order_dispute_v1(
  p_dispute_id uuid, p_seller_id uuid, p_response text
)
returns public.order_disputes language plpgsql security definer set search_path = '' as $$
declare v_dispute public.order_disputes%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  if char_length(btrim(p_response)) not between 20 and 4000 then raise exception using errcode = '22023', message = 'Invalid response.'; end if;
  select * into v_dispute from public.order_disputes where id = p_dispute_id for update;
  if not found or v_dispute.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Dispute access denied.'; end if;
  if v_dispute.status not in ('open', 'awaiting_seller_response') then raise exception using errcode = '55000', message = 'Dispute cannot be updated.'; end if;
  update public.order_disputes set seller_response = btrim(p_response), status = 'under_review'
  where id = p_dispute_id returning * into v_dispute;
  update public.orders set dispute_status = 'under_review', transfer_status = 'on_hold'
  where id = v_dispute.order_id;
  return v_dispute;
end;
$$;

create or replace function public.prepare_seller_payout_v2(p_order_id uuid, p_seller_id uuid)
returns table(
  release_id uuid, release_status text, stripe_transfer_id text,
  transfer_reference text, destination_account_id text, source_charge_id text,
  amount bigint, currency text, transfer_version smallint
)
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype; v_account public.seller_payment_accounts%rowtype;
  v_payment public.payments%rowtype; v_release public.seller_payout_releases%rowtype;
  v_amount bigint; v_release_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.seller_id <> p_seller_id then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.payment_status <> 'succeeded'
    or v_order.dispute_status not in ('none','resolved_seller','closed_no_action')
    or v_order.refund_status <> 'none' or v_order.fulfillment_status not in ('pickup_confirmed', 'delivered', 'completed')
    or v_order.transfer_status not in ('eligible', 'pending', 'transferred', 'failed')
    or v_order.payout_not_before is null or v_order.payout_not_before > now()
    or exists (select 1 from public.order_disputes d where d.order_id = p_order_id and d.status in ('open','awaiting_seller_response','under_review'))
    or exists (select 1 from public.order_refunds r where r.order_id = p_order_id and r.status in ('pending','creating','reconciling'))
    or exists (select 1 from public.transfer_reversals tr where tr.order_id = p_order_id and tr.status in ('pending','creating','reconciling'))
  then raise exception using errcode = '55000', message = 'Payout is not eligible.'; end if;
  select * into v_account from public.seller_payment_accounts where user_id = p_seller_id;
  if not found or v_account.risk_tier = 'restricted' or v_account.stripe_account_id is null
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
  if v_amount <= 0 then raise exception using errcode = '55000', message = 'Invalid payout amount.'; end if;
  insert into public.seller_payout_releases(id, order_id, seller_id, amount, currency,
    status, source_charge_id, destination_account_id, transfer_reference)
  values (v_release_id, p_order_id, p_seller_id, v_amount, v_order.currency,
    'creating', v_payment.stripe_charge_id, v_account.stripe_account_id,
    'payout_release_' || replace(v_release_id::text, '-', '')) on conflict (order_id) do nothing;
  select * into v_release from public.seller_payout_releases where order_id = p_order_id for update;
  if v_release.seller_id <> p_seller_id or v_release.amount <> v_amount
    or v_release.currency <> v_order.currency or v_release.source_charge_id <> v_payment.stripe_charge_id
    or v_release.destination_account_id <> v_account.stripe_account_id then
    raise exception using errcode = '22023', message = 'Payout data mismatch.';
  end if;
  if v_release.status = 'pending' then update public.seller_payout_releases set status = 'creating'
    where id = v_release.id returning * into v_release; end if;
  if v_release.status not in ('creating','reconciling','transferred','failed') then
    raise exception using errcode = '55000', message = 'Payout state is unavailable.'; end if;
  if v_release.status not in ('transferred','failed') then update public.orders
    set transfer_status = 'pending', seller_transfer_amount = v_amount where id = p_order_id; end if;
  return query select v_release.id, v_release.status, v_release.stripe_transfer_id,
    v_release.transfer_reference, v_release.destination_account_id, v_release.source_charge_id,
    v_release.amount, v_release.currency, v_release.transfer_version;
end;
$$;

-- Service-only refund/reversal claims preserve trusted identifiers before Stripe.
create or replace function public.prepare_order_refund_v1(
  p_order_id uuid, p_reason text, p_requested_by uuid, p_amount bigint default null
)
returns table(refund_id uuid, refund_status text, stripe_refund_id text,
  refund_reference text, payment_intent_id text, amount bigint, currency text)
language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_payment public.payments%rowtype;
  v_refund public.order_refunds%rowtype; v_amount bigint; v_reserved bigint;
  v_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  select * into v_payment from public.payments where order_id = p_order_id for update;
  if not found or v_order.payment_status not in ('succeeded','refund_pending','partially_refunded')
    or v_payment.stripe_payment_intent_id is null then raise exception using errcode = '55000', message = 'Payment is not refundable.'; end if;
  if p_reason in ('buyer_cancellation','seller_cancellation','platform_cancellation') then
    select * into v_refund from public.order_refunds where order_id = p_order_id
      and reason in ('buyer_cancellation','seller_cancellation','platform_cancellation')
      order by created_at limit 1 for update;
    if found then
      return query select v_refund.id, v_refund.status, v_refund.stripe_refund_id,
        v_refund.refund_reference, v_refund.stripe_payment_intent_id,
        v_refund.amount, v_refund.currency;
      return;
    end if;
  end if;
  select coalesce(sum(r.amount), 0) into v_reserved from public.order_refunds r
    where r.payment_id = v_payment.id
      and r.status in ('pending','creating','reconciling','succeeded');
  v_amount := coalesce(p_amount, v_payment.amount - v_reserved);
  if v_amount <= 0 or v_reserved + v_amount > v_payment.amount then
    raise exception using errcode = '22003', message = 'Invalid refund amount.';
  end if;
  insert into public.order_refunds(id, order_id, payment_id, amount, currency, reason,
    status, stripe_payment_intent_id, refund_reference, requested_by)
  values (v_id, p_order_id, v_payment.id, v_amount, v_payment.currency, p_reason,
    'creating', v_payment.stripe_payment_intent_id,
    'order_refund_' || replace(v_id::text, '-', ''), p_requested_by)
  on conflict do nothing returning * into v_refund;
  if not found then
    select * into v_refund from public.order_refunds where order_id = p_order_id
      and reason in ('buyer_cancellation','seller_cancellation','platform_cancellation')
      order by created_at limit 1 for update;
  end if;
  if not found or v_refund.amount <> v_amount or v_refund.payment_id <> v_payment.id then
    raise exception using errcode = '22023', message = 'Refund data mismatch.';
  end if;
  update public.orders set payment_status = 'refund_pending', refund_status = 'pending',
    transfer_status = 'on_hold' where id = p_order_id;
  return query select v_refund.id, v_refund.status, v_refund.stripe_refund_id,
    v_refund.refund_reference, v_refund.stripe_payment_intent_id, v_refund.amount, v_refund.currency;
end;
$$;

create or replace function public.finalize_order_refund_v1(p_refund_id uuid, p_stripe_refund_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_refund public.order_refunds%rowtype; v_total bigint; v_paid bigint;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_refund from public.order_refunds where id = p_refund_id for update;
  if not found or (v_refund.stripe_refund_id is not null and v_refund.stripe_refund_id <> p_stripe_refund_id)
    then raise exception using errcode = '22023', message = 'Refund mismatch.'; end if;
  update public.order_refunds set status = 'succeeded', stripe_refund_id = coalesce(stripe_refund_id, p_stripe_refund_id),
    succeeded_at = coalesce(succeeded_at, now()), failure_code = null where id = p_refund_id;
  select amount into v_paid from public.payments where id = v_refund.payment_id;
  select coalesce(sum(amount), 0) into v_total from public.order_refunds
    where payment_id = v_refund.payment_id and status = 'succeeded';
  update public.payments set refunded_amount = v_total,
    status = case when v_total = v_paid then 'refunded' else 'partially_refunded' end
    where id = v_refund.payment_id;
  update public.orders set payment_status = case when v_total = v_paid then 'refunded' else 'partially_refunded' end,
    refund_status = case when v_total = v_paid then 'refunded' else 'partially_refunded' end,
    transfer_status = 'on_hold' where id = v_refund.order_id;
end;
$$;

create or replace function public.mark_order_refund_reconciling_v1(p_refund_id uuid, p_failure_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  update public.order_refunds set status = 'reconciling',
    failure_code = left(coalesce(p_failure_code, 'UNKNOWN'), 100)
  where id = p_refund_id and status in ('creating','reconciling');
end;
$$;

create or replace function public.prepare_transfer_reversal_v1(p_refund_id uuid)
returns table(reversal_id uuid, reversal_status text, stripe_reversal_id text,
  reversal_reference text, transfer_id text, amount bigint, currency text)
language plpgsql security definer set search_path = '' as $$
declare v_refund public.order_refunds%rowtype; v_release public.seller_payout_releases%rowtype;
  v_reversal public.transfer_reversals%rowtype; v_prior bigint; v_amount bigint;
  v_id uuid := gen_random_uuid(); v_payment_amount bigint;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_refund from public.order_refunds where id = p_refund_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Refund not found.'; end if;
  select * into v_release from public.seller_payout_releases
    where order_id = v_refund.order_id for update;
  if not found or v_release.status <> 'transferred' or v_release.stripe_transfer_id is null then
    raise exception using errcode = '55000', message = 'Transferred payout not found.';
  end if;
  select amount into v_payment_amount from public.payments where id = v_refund.payment_id;
  select coalesce(sum(amount), 0) into v_prior from public.transfer_reversals
    where payout_release_id = v_release.id and status in ('creating','reconciling','succeeded');
  v_amount := least(v_release.amount - v_prior,
    floor((v_refund.amount::numeric * v_release.amount::numeric) / v_payment_amount)::bigint);
  if v_amount <= 0 or v_prior + v_amount > v_release.amount then
    raise exception using errcode = '22003', message = 'Invalid reversal amount.';
  end if;
  insert into public.transfer_reversals(id, order_id, payout_release_id, refund_id,
    amount, currency, status, stripe_transfer_id, reversal_reference)
  values (v_id, v_refund.order_id, v_release.id, v_refund.id, v_amount,
    v_release.currency, 'creating', v_release.stripe_transfer_id,
    'transfer_reversal_' || replace(v_id::text, '-', ''))
  on conflict do nothing returning * into v_reversal;
  if not found then select * into v_reversal from public.transfer_reversals
    where refund_id = v_refund.id for update; end if;
  update public.orders set transfer_status = 'on_hold' where id = v_refund.order_id;
  return query select v_reversal.id, v_reversal.status, v_reversal.stripe_reversal_id,
    v_reversal.reversal_reference, v_reversal.stripe_transfer_id,
    v_reversal.amount, v_reversal.currency;
end;
$$;

create unique index transfer_reversals_one_refund_idx on public.transfer_reversals (refund_id)
where refund_id is not null;
create unique index transfer_reversals_one_chargeback_idx on public.transfer_reversals (order_id)
where refund_id is null;

create or replace function public.prepare_chargeback_reversal_v1(p_order_id uuid)
returns table(reversal_id uuid, reversal_status text, stripe_reversal_id text,
  reversal_reference text, transfer_id text, amount bigint, currency text)
language plpgsql security definer set search_path = '' as $$
declare v_release public.seller_payout_releases%rowtype; v_reversal public.transfer_reversals%rowtype;
  v_prior bigint; v_amount bigint; v_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_release from public.seller_payout_releases where order_id = p_order_id for update;
  if not found or v_release.status <> 'transferred' or v_release.stripe_transfer_id is null then
    raise exception using errcode = '55000', message = 'Transferred payout not found.';
  end if;
  select coalesce(sum(amount), 0) into v_prior from public.transfer_reversals
    where payout_release_id = v_release.id and status in ('creating','reconciling','succeeded');
  v_amount := v_release.amount - v_prior;
  if v_amount <= 0 then raise exception using errcode = '22003', message = 'Invalid reversal amount.'; end if;
  insert into public.transfer_reversals(id, order_id, payout_release_id, amount,
    currency, status, stripe_transfer_id, reversal_reference)
  values (v_id, p_order_id, v_release.id, v_amount, v_release.currency, 'creating',
    v_release.stripe_transfer_id, 'chargeback_reversal_' || replace(v_id::text, '-', ''))
  on conflict do nothing returning * into v_reversal;
  if not found then select * into v_reversal from public.transfer_reversals
    where order_id = p_order_id and refund_id is null for update; end if;
  return query select v_reversal.id, v_reversal.status, v_reversal.stripe_reversal_id,
    v_reversal.reversal_reference, v_reversal.stripe_transfer_id,
    v_reversal.amount, v_reversal.currency;
end;
$$;

create or replace function public.finalize_transfer_reversal_v1(
  p_reversal_id uuid, p_stripe_reversal_id text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reversal public.transfer_reversals%rowtype; v_total bigint; v_release_amount bigint;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_reversal from public.transfer_reversals where id = p_reversal_id for update;
  if not found or (v_reversal.stripe_reversal_id is not null
    and v_reversal.stripe_reversal_id <> p_stripe_reversal_id) then
    raise exception using errcode = '22023', message = 'Reversal mismatch.';
  end if;
  update public.transfer_reversals set status = 'succeeded',
    stripe_reversal_id = coalesce(stripe_reversal_id, p_stripe_reversal_id),
    succeeded_at = coalesce(succeeded_at, now()), failure_code = null
  where id = p_reversal_id;
  select amount into v_release_amount from public.seller_payout_releases
    where id = v_reversal.payout_release_id;
  select coalesce(sum(amount), 0) into v_total from public.transfer_reversals
    where payout_release_id = v_reversal.payout_release_id and status = 'succeeded';
  update public.orders set transfer_status = case
    when v_total >= v_release_amount then 'reversed' else 'partially_reversed' end
  where id = v_reversal.order_id;
end;
$$;

create or replace function public.mark_transfer_reversal_reconciling_v1(
  p_reversal_id uuid, p_failure_code text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  update public.transfer_reversals set status = 'reconciling',
    failure_code = left(coalesce(p_failure_code, 'UNKNOWN'), 100)
  where id = p_reversal_id and status in ('creating','reconciling');
end;
$$;

create or replace function public.resolve_order_dispute_v1(
  p_dispute_id uuid, p_resolution text, p_note text
)
returns public.order_disputes language plpgsql security definer set search_path = '' as $$
declare v_dispute public.order_disputes%rowtype; v_order public.orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  if p_resolution not in ('resolved_buyer','resolved_seller','closed_no_action')
    or char_length(btrim(p_note)) not between 5 and 1000 then
    raise exception using errcode = '22023', message = 'Invalid resolution.';
  end if;
  select * into v_dispute from public.order_disputes where id = p_dispute_id for update;
  if not found or v_dispute.status not in ('open','awaiting_seller_response','under_review') then
    raise exception using errcode = '55000', message = 'Dispute cannot be resolved.';
  end if;
  select * into v_order from public.orders where id = v_dispute.order_id for update;
  update public.order_disputes set status = p_resolution, resolution = btrim(p_note),
    resolved_at = coalesce(resolved_at, now()) where id = p_dispute_id returning * into v_dispute;
  update public.orders set dispute_status = p_resolution, transfer_status = 'on_hold'
  where id = v_dispute.order_id;
  if p_resolution = 'resolved_buyer' then
    perform public.prepare_order_refund_v1(v_dispute.order_id,
      'dispute_resolved_buyer', null, null);
  elsif p_resolution in ('resolved_seller','closed_no_action')
    and v_order.fulfillment_status in ('pickup_confirmed','delivered','completed') then
    perform public.phase_d3_make_order_eligible(v_dispute.order_id);
  end if;
  return v_dispute;
end;
$$;

create or replace function public.cancel_order_v1(p_order_id uuid, p_actor_id uuid, p_actor_role text)
returns table(order_id uuid, requires_refund boolean)
language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_reason text; v_refund boolean;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted backend required.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or (p_actor_role = 'buyer' and v_order.buyer_id <> p_actor_id)
    or (p_actor_role = 'seller' and v_order.seller_id <> p_actor_id)
    or p_actor_role not in ('buyer','seller') then raise exception using errcode = '42501', message = 'Order access denied.'; end if;
  if v_order.fulfillment_status = 'canceled' then
    return query select p_order_id, v_order.payment_status in ('succeeded','refund_pending','partially_refunded');
    return;
  end if;
  if v_order.fulfillment_status in ('pickup_ready','pickup_confirmed','shipped','inspection_window','delivered','completed')
    then raise exception using errcode = '55000', message = 'Cancellation is not available.'; end if;
  v_refund := v_order.payment_status = 'succeeded';
  v_reason := case when p_actor_role = 'buyer' then 'buyer_requested' else 'seller_cancelled' end;
  update public.orders set fulfillment_status = 'canceled', canceled_at = coalesce(canceled_at, now()),
    cancellation_reason = v_reason, transfer_status = 'on_hold' where id = p_order_id;
  if not v_refund then
    update public.listings set status = 'active' where id = v_order.listing_id and status = 'reserved';
  end if;
  return query select p_order_id, v_refund;
end;
$$;

revoke all on function public.phase_d3_payout_not_before(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.phase_d3_make_order_eligible(uuid) from public, anon, authenticated;
revoke all on function public.issue_pickup_proof(uuid) from public, anon, authenticated;
revoke all on function public.consume_pickup_pin_v1(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.accept_order_delivery_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.expire_order_inspections_v1(integer) from public, anon, authenticated;
revoke all on function public.open_order_dispute_v1(uuid, uuid, text, text, text[]) from public, anon, authenticated;
revoke all on function public.respond_order_dispute_v1(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_order_dispute_v1(uuid, text, text) from public, anon, authenticated;
revoke all on function public.prepare_order_refund_v1(uuid, text, uuid, bigint) from public, anon, authenticated;
revoke all on function public.finalize_order_refund_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_order_refund_reconciling_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.prepare_transfer_reversal_v1(uuid) from public, anon, authenticated;
revoke all on function public.prepare_chargeback_reversal_v1(uuid) from public, anon, authenticated;
revoke all on function public.finalize_transfer_reversal_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_transfer_reversal_reconciling_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_order_v1(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.issue_pickup_token(uuid) from public, anon, authenticated;
grant execute on function public.issue_pickup_proof(uuid) to authenticated;
grant execute on function public.phase_d3_payout_not_before(uuid, timestamptz) to service_role;
grant execute on function public.phase_d3_make_order_eligible(uuid) to service_role;
grant execute on function public.consume_pickup_pin_v1(uuid, uuid, text) to service_role;
grant execute on function public.accept_order_delivery_v1(uuid, uuid) to service_role;
grant execute on function public.expire_order_inspections_v1(integer) to service_role;
grant execute on function public.open_order_dispute_v1(uuid, uuid, text, text, text[]) to service_role;
grant execute on function public.respond_order_dispute_v1(uuid, uuid, text) to service_role;
grant execute on function public.resolve_order_dispute_v1(uuid, text, text) to service_role;
grant execute on function public.prepare_order_refund_v1(uuid, text, uuid, bigint) to service_role;
grant execute on function public.finalize_order_refund_v1(uuid, text) to service_role;
grant execute on function public.mark_order_refund_reconciling_v1(uuid, text) to service_role;
grant execute on function public.prepare_transfer_reversal_v1(uuid) to service_role;
grant execute on function public.prepare_chargeback_reversal_v1(uuid) to service_role;
grant execute on function public.finalize_transfer_reversal_v1(uuid, text) to service_role;
grant execute on function public.mark_transfer_reversal_reconciling_v1(uuid, text) to service_role;
grant execute on function public.cancel_order_v1(uuid, uuid, text) to service_role;

create index orders_inspection_expiry_idx on public.orders (inspection_expires_at)
where fulfillment_status = 'inspection_window';
create index orders_payout_schedule_idx on public.orders (payout_not_before)
where transfer_status = 'eligible';

comment on column public.orders.actual_processing_amount is
  'Accounting only. V1 platform absorbs Stripe processing costs; this is never deducted from seller proceeds.';

-- Preserve already-earned D2 eligibility while applying the new private risk delay.
update public.orders o set
  payout_not_before = o.payout_eligible_at + make_interval(days => a.payout_delay_days),
  transfer_status = case when a.risk_tier = 'restricted' then 'on_hold' else o.transfer_status end
from public.seller_payment_accounts a
where a.user_id = o.seller_id and o.payout_eligible_at is not null
  and o.payout_not_before is null and o.transfer_status in ('eligible','on_hold');

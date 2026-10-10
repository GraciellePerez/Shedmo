-- Phase D1: minimum trusted-backend access for fixed-price checkout.
-- Browser roles retain the read-only grants and RLS policies established in
-- the payment foundation migration.

grant select, update on table public.orders to service_role;
grant select, insert, update on table public.payments to service_role;
grant select, update on table public.listings to service_role;

create or replace function public.is_listing_checkout_eligible(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'authenticated' and exists (
    select 1
    from public.listings l
    join public.seller_payment_accounts spa on spa.user_id = l.seller_id
    where l.id = p_listing_id
      and l.status = 'active'
      and (l.pickup_available or l.shipping_available)
      and spa.onboarding_status = 'enabled'
      and spa.details_submitted
      and spa.payouts_enabled
      and spa.transfer_capability_status = 'active'
      and spa.risk_tier <> 'restricted'
  );
$$;

revoke all on function public.is_listing_checkout_eligible(uuid) from public, anon, authenticated;
grant execute on function public.is_listing_checkout_eligible(uuid) to authenticated;

create or replace function public.apply_checkout_payment_event(
  p_order_id uuid,
  p_payment_intent_id text,
  p_status text,
  p_amount bigint,
  p_currency text,
  p_charge_id text default null,
  p_failure_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted backend required.';
  end if;
  if p_status not in ('processing', 'succeeded', 'failed', 'canceled') then
    raise exception using errcode = '22023', message = 'Unsupported payment status.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Order not found.';
  end if;

  select * into v_payment
  from public.payments
  where order_id = p_order_id
  for update;
  if not found
    or v_payment.stripe_payment_intent_id is distinct from p_payment_intent_id
    or v_payment.amount is distinct from p_amount
    or v_payment.currency is distinct from lower(p_currency)
    or v_order.total_amount is distinct from p_amount
    or v_order.currency is distinct from lower(p_currency)
  then
    raise exception using errcode = '22023', message = 'Payment data mismatch.';
  end if;

  -- A delayed failure/cancel event must never downgrade a confirmed payment.
  if v_payment.status = 'succeeded' and p_status <> 'succeeded' then
    return;
  end if;

  update public.payments
  set status = p_status,
      stripe_charge_id = case
        when p_status = 'succeeded' then coalesce(p_charge_id, stripe_charge_id)
        else stripe_charge_id
      end,
      failure_code = case
        when p_status = 'failed' then left(p_failure_code, 100)
        when p_status in ('processing', 'succeeded') then null
        else failure_code
      end
  where order_id = p_order_id;

  if p_status = 'succeeded' then
    update public.listings
    set status = 'sold'
    where id = v_order.listing_id and status in ('reserved', 'sold');
    if not found then
      raise exception using errcode = '55000', message = 'Listing state mismatch.';
    end if;

    update public.orders
    set payment_status = 'succeeded',
        paid_at = coalesce(paid_at, now()),
        fulfillment_status = case
          when fulfillment_type = 'pickup' then 'pickup_scheduled'
          else 'awaiting_shipment'
        end
    where id = p_order_id;
  elsif p_status = 'processing' then
    update public.orders
    set payment_status = 'processing', fulfillment_status = 'awaiting_payment'
    where id = p_order_id and payment_status <> 'succeeded';
  else
    update public.orders
    set payment_status = p_status
    where id = p_order_id and payment_status <> 'succeeded';
  end if;
end;
$$;

revoke all on function public.apply_checkout_payment_event(
  uuid, text, text, bigint, text, text, text
) from public, anon, authenticated;
grant execute on function public.apply_checkout_payment_event(
  uuid, text, text, bigint, text, text, text
) to service_role;

-- Verification after applying:
-- select table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'service_role' and table_schema = 'public'
--   and table_name in ('orders', 'payments', 'listings', 'order_status_history')
-- order by table_name, privilege_type;
-- select
--   has_table_privilege('service_role', 'public.orders', 'SELECT, UPDATE'),
--   has_table_privilege('service_role', 'public.payments', 'SELECT, INSERT, UPDATE'),
--   has_table_privilege('service_role', 'public.listings', 'SELECT, UPDATE'),
--   has_table_privilege('service_role', 'public.orders', 'DELETE'),
--   has_table_privilege('service_role', 'public.payments', 'DELETE');

-- Expired unpaid checkout reservations must return to Browse without requiring
-- a buyer to know the hidden listing id. The routine is backend-only and the
-- cron job also repairs reservations left by interrupted initialization.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.release_expired_checkout_reservations_v1()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer;
begin
  with expired as (
    update public.orders o
    set payment_status = 'canceled',
        fulfillment_status = 'canceled',
        cancellation_reason = 'reservation_expired',
        canceled_at = coalesce(o.canceled_at, now())
    where o.fulfillment_status in ('reserved','awaiting_payment')
      and o.payment_status in ('none','failed','canceled')
      and o.reservation_expires_at <= now()
    returning o.listing_id
  ), released as (
    update public.listings l
    set status = 'active'
    where l.status = 'reserved'
      and l.id in (select e.listing_id from expired e)
      and not exists (
        select 1 from public.orders current_order
        where current_order.listing_id = l.id
          and current_order.fulfillment_status in ('reserved','awaiting_payment')
          and current_order.payment_status in ('none','pending','processing')
          and current_order.reservation_expires_at > now()
      )
    returning l.id
  )
  select count(*)::integer into v_released from released;
  return v_released;
end;
$$;

revoke all on function public.release_expired_checkout_reservations_v1()
  from public, anon, authenticated;

-- Repair any already-expired development reservations as this migration lands.
select public.release_expired_checkout_reservations_v1();

select cron.schedule(
  'release-expired-checkout-reservations',
  '* * * * *',
  'select public.release_expired_checkout_reservations_v1()'
)
where not exists (
  select 1 from cron.job where jobname = 'release-expired-checkout-reservations'
);

-- Checkout's trusted backend must verify staff-managed seller restrictions.
-- Browser roles retain their existing privileges; Stripe and admin fields are
-- not exposed by this grant.

grant select (id, staff_sell_restricted, account_suspended_at)
on table public.profiles
to service_role;

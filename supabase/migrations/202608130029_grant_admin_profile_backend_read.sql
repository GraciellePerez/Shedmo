-- The trusted admin Users queue needs public profile identity and moderation
-- state. This does not grant browser roles access or bypass staff authorization.
grant select (
  id,
  display_name,
  username,
  avatar_url,
  city,
  state,
  created_at,
  account_suspended_at,
  staff_sell_restricted
)
on table public.profiles
to service_role;

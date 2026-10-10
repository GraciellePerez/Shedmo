-- Local only. No profile data changes; apply separately after approval.
begin;

-- Table-wide SELECT otherwise exposes every subsequently added private column.
revoke select on public.profiles from public, anon, authenticated;
revoke select (id, display_name, username, bio, avatar_url, city, state,
  created_at, updated_at, postal_code, account_suspended_at,
  account_suspended_by, staff_sell_restricted)
  on public.profiles from public, anon, authenticated;
grant select (id, display_name, username, bio, avatar_url, city, state, created_at)
  on public.profiles to anon, authenticated;

-- No caller-supplied identity, no moderation columns, no SELECT * return type.
create function public.get_my_profile_v1()
returns table (
  id uuid, display_name text, username text, bio text, avatar_url text,
  city text, state text, postal_code text, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.username, p.bio, p.avatar_url,
    p.city, p.state, p.postal_code, p.created_at, p.updated_at
  from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.get_my_profile_v1() from public, anon;
grant execute on function public.get_my_profile_v1() to authenticated;

-- Preserve the existing trigger's moderation checks without granting clients
-- SELECT on internal flags. Its body and auth.role() checks remain unchanged.
alter function public.enforce_listing_moderation() security definer;
revoke all on function public.enforce_listing_moderation() from public, anon, authenticated;

-- Existing owner INSERT/UPDATE RLS and backend grants remain unchanged.
commit;

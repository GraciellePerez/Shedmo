-- Bio is intentionally public seller information. ZIP codes and coordinates
-- remain excluded from this narrow seller-profile RPC.
drop function if exists public.get_public_seller_profile(uuid);

create function public.get_public_seller_profile(p_seller_id uuid)
returns table (
  seller_id uuid,
  display_name text,
  username text,
  avatar_url text,
  bio text,
  city text,
  state text,
  member_since timestamptz,
  active_listing_count bigint,
  sold_listing_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_seller_id is null then
    raise exception 'Seller ID is required';
  end if;

  return query
  select
    p.id,
    p.display_name,
    p.username,
    p.avatar_url,
    p.bio,
    p.city,
    p.state,
    p.created_at,
    count(l.id) filter (where l.status = 'active'),
    count(l.id) filter (where l.status = 'sold')
  from public.profiles p
  left join public.listings l on l.seller_id = p.id
  where p.id = p_seller_id
  group by
    p.id,
    p.display_name,
    p.username,
    p.avatar_url,
    p.bio,
    p.city,
    p.state,
    p.created_at;
end;
$$;

revoke all on function public.get_public_seller_profile(uuid) from public;
grant execute on function public.get_public_seller_profile(uuid) to authenticated;

comment on function public.get_public_seller_profile(uuid) is
  'Returns approved public seller identity, bio, city/state, and listing counts; never email, ZIP, coordinates, or auth metadata.';

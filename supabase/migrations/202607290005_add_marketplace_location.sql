-- Marketplace location foundation. This migration is forward-only and does not
-- require PostGIS; distance pagination is performed by the RPC below.

alter table public.profiles
  add column if not exists postal_code text;

alter table public.profiles
  add constraint profiles_postal_code_check
  check (postal_code is null or char_length(btrim(postal_code)) between 3 and 12)
  not valid;

alter table public.listings
  add column if not exists postal_code text,
  add column if not exists location_source text,
  add column if not exists location_updated_at timestamptz;

alter table public.listings
  add constraint listings_latitude_check
    check (latitude is null or latitude between -90 and 90) not valid,
  add constraint listings_longitude_check
    check (longitude is null or longitude between -180 and 180) not valid,
  add constraint listings_coordinate_pair_check
    check ((latitude is null) = (longitude is null)) not valid,
  add constraint listings_location_source_check
    check (location_source is null or location_source in ('device', 'manual', 'profile')) not valid,
  add constraint listings_postal_code_check
    check (postal_code is null or char_length(btrim(postal_code)) between 3 and 12) not valid,
  add constraint listings_active_location_check
    check (
      status <> 'active'
      or (latitude is not null and longitude is not null)
      or (nullif(btrim(city), '') is not null and nullif(btrim(state), '') is not null)
    ) not valid;

create or replace function public.normalize_marketplace_listing_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.city := nullif(initcap(btrim(new.city)), '');
  new.state := nullif(upper(btrim(new.state)), '');
  new.postal_code := nullif(upper(btrim(new.postal_code)), '');

  -- Public listing coordinates are intentionally reduced to roughly
  -- neighborhood precision. Raw device coordinates are never stored.
  if new.latitude is not null then
    new.latitude := round(new.latitude::numeric, 3)::double precision;
    new.longitude := round(new.longitude::numeric, 3)::double precision;
  end if;

  if tg_op = 'INSERT' then
    if new.latitude is not null or new.city is not null then
      new.location_updated_at := coalesce(new.location_updated_at, now());
    end if;
  elsif (new.latitude, new.longitude, new.city, new.state, new.postal_code, new.location_source)
    is distinct from
    (old.latitude, old.longitude, old.city, old.state, old.postal_code, old.location_source) then
    new.location_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_listing_location on public.listings;
create trigger normalize_listing_location
before insert or update of latitude, longitude, city, state, postal_code, location_source
on public.listings
for each row execute function public.normalize_marketplace_listing_location();

create index if not exists listings_status_created_at_idx
  on public.listings (status, created_at desc);
create index if not exists listings_status_coordinates_idx
  on public.listings (status, latitude, longitude)
  where latitude is not null and longitude is not null;

create or replace function public.nearby_listings(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_miles double precision default null,
  p_limit integer default 13,
  p_offset integer default 0,
  p_sort text default 'nearest'
)
returns table (listing_id uuid, distance_miles double precision)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid browsing coordinates';
  end if;
  if p_radius_miles is not null and p_radius_miles not in (5, 10, 25, 50, 100) then
    raise exception 'Unsupported radius';
  end if;
  if p_sort not in ('nearest', 'newest') then
    raise exception 'Unsupported sort';
  end if;

  return query
  select l.id, d.miles
  from public.listings l
  cross join lateral (
    select 3958.7613 * 2 * asin(sqrt(least(1::double precision, greatest(
      0::double precision,
      power(sin(radians((l.latitude - p_latitude) / 2)), 2)
      + cos(radians(p_latitude)) * cos(radians(l.latitude))
      * power(sin(radians((l.longitude - p_longitude) / 2)), 2)
    )))) as miles
  ) d
  where l.status = 'active'
    and l.latitude is not null
    and l.longitude is not null
    and (p_radius_miles is null or d.miles <= p_radius_miles)
  order by
    case when p_sort = 'nearest' then d.miles end asc,
    case when p_sort = 'newest' then l.created_at end desc,
    l.created_at desc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.nearby_listings(double precision, double precision, double precision, integer, integer, text) from public;
grant execute on function public.nearby_listings(double precision, double precision, double precision, integer, integer, text) to authenticated;

comment on function public.nearby_listings is
  'RLS-aware, server-paginated Haversine listing search. Returns approximate distance only.';

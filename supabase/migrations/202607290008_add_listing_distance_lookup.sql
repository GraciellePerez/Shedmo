-- Resolve one visible listing's approximate distance without exposing a
-- separate client-side Haversine implementation.
create or replace function public.listing_distance_miles(
  p_listing_id uuid,
  p_latitude double precision,
  p_longitude double precision
)
returns double precision
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result double precision;
begin
  if p_latitude is null or p_longitude is null then
    raise exception 'Coordinates are required';
  end if;

  if (
    p_latitude not between -90 and 90
    or p_longitude not between -180 and 180
  ) then
    raise exception 'Invalid coordinates';
  end if;

  select
    3958.7613 * 2 * asin(sqrt(least(1::double precision, greatest(
      0::double precision,
      power(sin(radians((l.latitude - p_latitude) / 2)), 2)
      + cos(radians(p_latitude)) * cos(radians(l.latitude))
      * power(sin(radians((l.longitude - p_longitude) / 2)), 2)
    ))))
  into result
  from public.listings l
  where l.id = p_listing_id
    and l.latitude is not null
    and l.longitude is not null;

  return result;
end;
$$;

revoke all on function public.listing_distance_miles(uuid, double precision, double precision) from public;
grant execute on function public.listing_distance_miles(uuid, double precision, double precision) to authenticated;

comment on function public.listing_distance_miles(uuid, double precision, double precision) is
  'Returns approximate Haversine miles for one listing visible under the caller''s existing RLS policies.';

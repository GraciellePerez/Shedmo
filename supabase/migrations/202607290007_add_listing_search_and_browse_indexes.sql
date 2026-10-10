-- Production listing search and cursor-paginated browse query.
alter table public.listings
  add column if not exists search_document tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(brand, '')), 'B')
    || setweight(to_tsvector('english', replace(coalesce(category, ''), '_', ' ')), 'B')
    || setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored;

create index if not exists listings_search_document_idx
  on public.listings using gin (search_document);
create index if not exists listings_active_category_condition_newest_idx
  on public.listings (category, condition, created_at desc, id desc) where status = 'active';
create index if not exists listings_active_price_newest_idx
  on public.listings (price, created_at desc, id desc) where status = 'active';

create or replace function public.search_marketplace_listings(
  p_query text default null,
  p_category text default null,
  p_condition text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_miles double precision default null,
  p_sort text default 'newest',
  p_limit integer default 21,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_price numeric default null,
  p_cursor_distance double precision default null
)
returns table (
  listing_id uuid,
  distance_miles double precision,
  cursor_created_at timestamptz,
  cursor_price numeric
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'Invalid page size'; end if;
  if p_sort not in ('newest', 'closest', 'price_asc', 'price_desc') then
    raise exception 'Unsupported sort';
  end if;
  if p_category is not null and p_category not in (
    'tools','auto_parts','tool_storage','equipment','marine','outdoor_power','shop_equipment','supplies'
  ) then raise exception 'Unsupported category'; end if;
  if p_condition is not null and p_condition not in ('new','like_new','good','fair','for_parts') then
    raise exception 'Unsupported condition';
  end if;
  if (
    (p_min_price is not null and p_min_price < 0)
    or (p_max_price is not null and p_max_price < 0)
    or (
      p_min_price is not null
      and p_max_price is not null
      and p_max_price < p_min_price
    )
  ) then
    raise exception 'Invalid price range';
  end if;
  if p_radius_miles is not null and p_radius_miles not in (10,25,50,100,250) then
    raise exception 'Unsupported radius';
  end if;
  if (
    (p_latitude is null and p_longitude is not null)
    or (p_latitude is not null and p_longitude is null)
  ) then
    raise exception 'Latitude and longitude must be supplied together';
  end if;
  if (
    (p_sort = 'closest' or p_radius_miles is not null)
    and (p_latitude is null or p_longitude is null)
  ) then
    raise exception 'Location is required';
  end if;
  if (
    (p_latitude is not null and p_latitude not between -90 and 90)
    or (p_longitude is not null and p_longitude not between -180 and 180)
  ) then
    raise exception 'Invalid coordinates';
  end if;
  if p_cursor_id is not null and p_cursor_created_at is null then
    raise exception 'Cursor created_at is required';
  end if;
  if (
    p_cursor_id is not null
    and p_sort in ('price_asc', 'price_desc')
    and p_cursor_price is null
  ) then
    raise exception 'Cursor price is required';
  end if;
  if (
    p_cursor_id is not null
    and p_sort = 'closest'
    and p_cursor_distance is null
  ) then
    raise exception 'Cursor distance is required';
  end if;

  return query
  with candidates as (
    select l.*,
      case when p_latitude is null then null else
        3958.7613 * 2 * asin(sqrt(least(1::double precision, greatest(0::double precision,
          power(sin(radians((l.latitude - p_latitude) / 2)), 2)
          + cos(radians(p_latitude)) * cos(radians(l.latitude))
          * power(sin(radians((l.longitude - p_longitude) / 2)), 2)
        ))))
      end as miles
    from public.listings l
    where l.status = 'active'
      and (nullif(btrim(p_query), '') is null
        or l.search_document @@ websearch_to_tsquery('english', btrim(p_query)))
      and (p_category is null or l.category = p_category)
      and (p_condition is null or l.condition = p_condition)
      and (p_min_price is null or l.price >= p_min_price)
      and (p_max_price is null or l.price <= p_max_price)
      and ((p_radius_miles is null and p_sort <> 'closest')
        or (l.latitude is not null and l.longitude is not null))
  )
  select c.id, c.miles, c.created_at, c.price
  from candidates c
  where (p_radius_miles is null or c.miles <= p_radius_miles)
    and (
      p_cursor_id is null
      or (p_sort = 'newest' and (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
      or (p_sort = 'price_asc' and (
        c.price > p_cursor_price or (c.price = p_cursor_price and (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
      ))
      or (p_sort = 'price_desc' and (
        c.price < p_cursor_price or (c.price = p_cursor_price and (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
      ))
      or (p_sort = 'closest' and (
        c.miles > p_cursor_distance or (c.miles = p_cursor_distance and (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
      ))
    )
  order by
    case when p_sort = 'closest' then c.miles end asc,
    case when p_sort = 'price_asc' then c.price end asc,
    case when p_sort = 'price_desc' then c.price end desc,
    c.created_at desc, c.id desc
  limit p_limit;
end;
$$;

revoke all on function public.search_marketplace_listings(text,text,text,numeric,numeric,double precision,double precision,double precision,text,integer,timestamptz,uuid,numeric,double precision) from public;
grant execute on function public.search_marketplace_listings(text,text,text,numeric,numeric,double precision,double precision,double precision,text,integer,timestamptz,uuid,numeric,double precision) to authenticated;

comment on function public.search_marketplace_listings(
  text, text, text, numeric, numeric, double precision, double precision,
  double precision, text, integer, timestamptz, uuid, numeric, double precision
) is
  'RLS-aware full-text marketplace search with filters, stable cursor pagination, and optional Haversine distance.';

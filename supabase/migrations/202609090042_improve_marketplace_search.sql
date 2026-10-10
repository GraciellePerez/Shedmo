-- Search-only expression index: no listing columns, policies, or write rules change.
-- Keep raw words for prefixes, English stems for existing word inflections, and
-- single-deletion keys for indexed typo candidates. Candidates are verified below.
create function public.marketplace_search_normalize(p_text text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

create function public.marketplace_search_keys(p_text text)
returns text[] language sql immutable parallel safe set search_path = '' as $$
  with words as (
    select distinct word from unnest(string_to_array(public.marketplace_search_normalize(p_text), ' ')) word
    where word <> ''
  ), keys as (
    -- Stay below PostgreSQL's 2046-byte lexeme limit even for existing long
    -- Unicode tokens. The scorer still checks the original, untruncated text.
    select 'w' || left(word, 500) as key from words
    union
    select 's' || stem from unnest(tsvector_to_array(to_tsvector('english', public.marketplace_search_normalize(p_text)))) stem
    union
    select 'd' || word from words where length(word) between 4 and 32
    union
    select 'd' || left(word, n - 1) || substr(word, n + 1)
    from words cross join lateral generate_series(1, length(word)) n
    where length(word) between 4 and 32
  ) select coalesce(array_agg(key), array[]::text[]) from keys;
$$;

create function public.marketplace_search_document(p_title text, p_description text, p_category text, p_brand text)
returns tsvector language sql immutable parallel safe set search_path = '' as $$
  select array_to_tsvector(public.marketplace_search_keys(
    coalesce(p_title, '') || ' ' || coalesce(p_description, '') || ' ' ||
    coalesce(p_category, '') || ' ' || coalesce(p_brand, '')
  ));
$$;

create index listings_active_search_terms_idx on public.listings using gin
  (public.marketplace_search_document(title, description, category, brand))
  where status = 'active';

create function public.marketplace_search_query(p_text text)
returns tsquery language sql immutable parallel safe set search_path = '' as $$
  select string_agg('(' || alternatives || ')', ' & ')::tsquery
  from (
    select word, string_agg(quote_literal(key) || case when left(key, 1) = 'w' then ':*' else '' end, ' | ') alternatives
    from (select distinct word from unnest(string_to_array(public.marketplace_search_normalize(p_text), ' ')) word where word <> '') words
    cross join lateral unnest(public.marketplace_search_keys(word)) key
    group by word
  ) terms;
$$;

-- PostgreSQL cannot push the non-leakproof @@ operator through listing RLS.
-- This non-API helper reads only candidate IDs from active inventory. The public
-- SECURITY INVOKER RPC must join them back to listings under the caller's RLS.
-- Keep this schema out of PostgREST's exposed schemas; no listing text is exposed.
create schema if not exists marketplace_search_private;
revoke all on schema marketplace_search_private from public, anon, authenticated;
grant usage on schema marketplace_search_private to authenticated;

create function marketplace_search_private.candidate_ids(p_terms tsquery)
returns table (id uuid)
language sql stable security definer rows 20 set search_path = '' as $$
  select l.id from public.listings l
  where p_terms is not null and l.status = 'active'
    and public.marketplace_search_document(l.title, l.description, l.category, l.brand) @@ p_terms;
$$;
revoke all on function marketplace_search_private.candidate_ids(tsquery) from public, anon;
grant execute on function marketplace_search_private.candidate_ids(tsquery) to authenticated;

-- At most one insertion, deletion, substitution, or adjacent transposition.
-- Short words/model numbers do not get fuzzy matching; long tokens stay literal.
create function public.marketplace_search_one_edit(p_left text, p_right text)
returns boolean language plpgsql immutable parallel safe set search_path = '' as $$
declare
  a integer := length(p_left);
  b integer := length(p_right);
  i integer := 1;
begin
  if a not between 4 and 32 or b not between 4 and 32
    or p_left !~ '^[[:alpha:]]+$' or p_right !~ '^[[:alpha:]]+$'
    or abs(a - b) > 1 then return false; end if;
  while i <= least(a, b) and substr(p_left, i, 1) = substr(p_right, i, 1) loop
    i := i + 1;
  end loop;
  if a = b then
    return substr(p_left, i + 1) = substr(p_right, i + 1)
      or (substr(p_left, i, 1) = substr(p_right, i + 1, 1)
        and substr(p_left, i + 1, 1) = substr(p_right, i, 1)
        and substr(p_left, i + 2) = substr(p_right, i + 2));
  elsif a > b then return substr(p_left, i + 1) = substr(p_right, i);
  else return substr(p_left, i) = substr(p_right, i + 1);
  end if;
end;
$$;

create function public.marketplace_search_score(p_query text, p_title text, p_description text, p_category text, p_brand text)
returns integer language sql immutable parallel safe set search_path = '' as $$
  with terms as (
    select distinct word from unnest(string_to_array(public.marketplace_search_normalize(p_query), ' ')) word where word <> ''
  ), fields as (
    select word, weight from (values (p_title, 80), (p_category, 60), (p_brand, 50), (p_description, 30)) f(body, weight)
    cross join lateral unnest(string_to_array(public.marketplace_search_normalize(body), ' ')) word
    where word <> ''
  ), matches as (
    select t.word, coalesce(max(case
      when starts_with(f.word, t.word)
        or to_tsvector('english', f.word) @@ plainto_tsquery('english', t.word) then f.weight
      when public.marketplace_search_one_edit(t.word, f.word) then 10
      else 0 end), 0) strength
    from terms t left join fields f on true group by t.word
  )
  select case
    when count(*) = 0 or min(strength) = 0 then 0
    when min(strength) < 30 then 100 + avg(strength)::integer
    when public.marketplace_search_normalize(p_title) = public.marketplace_search_normalize(p_query) then 600
    when starts_with(public.marketplace_search_normalize(p_title), public.marketplace_search_normalize(p_query)) then 500
    when min(strength) = 80 then 400 + avg(strength)::integer
    when min(strength) >= 60 then 300 + avg(strength)::integer
    else 200 + avg(strength)::integer end
  from matches;
$$;

create or replace function public.search_marketplace_listings_v3(
  p_query text default null,
  p_category text default null,
  p_condition text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_radius_miles double precision default null,
  p_fulfillment text default 'all',
  p_sort text default 'relevance',
  p_limit integer default 21,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_price numeric default null,
  p_cursor_distance double precision default null,
  p_cursor_score integer default null
)
returns table (
  listing_id uuid,
  distance_miles double precision,
  cursor_created_at timestamptz,
  cursor_price numeric,
  cursor_score integer
)
language plpgsql
security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_query text := public.marketplace_search_normalize(p_query);
  v_terms tsquery;
begin
  if length(coalesce(p_query, '')) > 512 then raise exception 'Search query is too long'; end if;
  v_terms := public.marketplace_search_query(v_query);
  if p_fulfillment is null or p_fulfillment not in ('all', 'pickup', 'shipping') then
    raise exception 'Unsupported fulfillment filter';
  end if;
  if p_sort = 'relevance' and p_cursor_id is not null and p_cursor_score is null then
    raise exception 'Cursor score is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'Invalid page size'; end if;
  if p_sort is null or p_sort not in ('relevance', 'newest', 'closest', 'price_asc', 'price_desc') then
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
  with candidates as not materialized (
    select l.*,
      case when v_query = '' then 0 else public.marketplace_search_score(
        v_query, l.title, l.description, l.category, l.brand) end as score,
      case when p_latitude is null then null else
        3958.7613 * 2 * asin(sqrt(least(1::double precision, greatest(0::double precision,
          power(sin(radians((l.latitude - p_latitude) / 2)), 2)
          + cos(radians(p_latitude)) * cos(radians(l.latitude))
          * power(sin(radians((l.longitude - p_longitude) / 2)), 2)
        ))))
      end as miles
    from (
      -- Separate branches keep empty browsing on its existing indexes and let
      -- nonempty searches look up only candidate IDs through the primary key.
      select b.* from public.listings b where v_terms is null
      union all
      select b.* from marketplace_search_private.candidate_ids(v_terms) hit
      join public.listings b on b.id = hit.id
      where v_terms is not null
    ) l
    where l.status = 'active'
      and (p_fulfillment = 'all'
        or (p_fulfillment = 'pickup' and l.pickup_available)
        or (p_fulfillment = 'shipping' and l.shipping_available))
      and (p_category is null or l.category = p_category)
      and (p_condition is null or l.condition = p_condition)
      and (p_min_price is null or l.price >= p_min_price)
      and (p_max_price is null or l.price <= p_max_price)
      and ((p_radius_miles is null and p_sort <> 'closest')
        or (l.latitude is not null and l.longitude is not null))
  )
  select c.id, c.miles, c.created_at, c.price, c.score
  from candidates c
  where (v_query = '' or c.score > 0)
    and (p_radius_miles is null or c.miles <= p_radius_miles)
    and (
      p_cursor_id is null
      or (p_sort = 'relevance' and (c.score, c.created_at, c.id) < (p_cursor_score, p_cursor_created_at, p_cursor_id))
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
    case when p_sort = 'relevance' then c.score end desc,
    case when p_sort = 'closest' then c.miles end asc,
    case when p_sort = 'price_asc' then c.price end asc,
    case when p_sort = 'price_desc' then c.price end desc,
    c.created_at desc, c.id desc
  limit p_limit;
end;
$$;

revoke all on function public.search_marketplace_listings_v3(text,text,text,numeric,numeric,double precision,double precision,double precision,text,text,integer,timestamptz,uuid,numeric,double precision,integer) from public;
grant execute on function public.search_marketplace_listings_v3(text,text,text,numeric,numeric,double precision,double precision,double precision,text,text,integer,timestamptz,uuid,numeric,double precision,integer) to authenticated;

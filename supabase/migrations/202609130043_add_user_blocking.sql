-- PENDING APPROVAL: created locally only. Do not apply without owner approval.
-- Blocking is directional for discovery and bilateral for new communication.
begin;

create table public.user_blocks (
  blocker_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint user_blocks_not_self check (blocker_user_id <> blocked_user_id)
);
create index user_blocks_blocked_idx on public.user_blocks(blocked_user_id, blocker_user_id);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from public, anon, authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
create policy user_blocks_own_read on public.user_blocks for select to authenticated
  using (blocker_user_id = (select auth.uid()));
create policy user_blocks_own_insert on public.user_blocks for insert to authenticated
  with check (blocker_user_id = (select auth.uid()));
create policy user_blocks_own_delete on public.user_blocks for delete to authenticated
  using (blocker_user_id = (select auth.uid()));

-- Shared pair lock serializes blocks and new communication, including direct SQL
-- inserts. No RPC permits callers to inspect another user's block relationships.
create function public.lock_block_pair_v1(p_first uuid, p_second uuid) returns void
language sql volatile set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    least(p_first, p_second)::text || ':' || greatest(p_first, p_second)::text, 0));
$$;
revoke all on function public.lock_block_pair_v1(uuid,uuid) from public, anon, authenticated;

create function public.guard_block_relationship_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.lock_block_pair_v1(old.blocker_user_id, old.blocked_user_id);
    return old;
  end if;
  perform public.lock_block_pair_v1(new.blocker_user_id, new.blocked_user_id);
  return new;
end;
$$;
revoke all on function public.guard_block_relationship_v1() from public, anon, authenticated;
create trigger user_blocks_guard before insert or delete on public.user_blocks
for each row execute function public.guard_block_relationship_v1();

create function public.set_user_block_v1(p_blocked_user_id uuid, p_blocked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_blocked_user_id is null or p_blocked is null or p_blocked_user_id = v_actor then
    raise exception 'Invalid user' using errcode = '22023';
  end if;
  perform public.lock_block_pair_v1(v_actor, p_blocked_user_id);
  if p_blocked then
    if not exists (select 1 from public.profiles where id = p_blocked_user_id) then
      raise exception 'User unavailable' using errcode = '22023';
    end if;
    insert into public.user_blocks(blocker_user_id, blocked_user_id)
      values (v_actor, p_blocked_user_id) on conflict do nothing;
  else
    delete from public.user_blocks where blocker_user_id = v_actor and blocked_user_id = p_blocked_user_id;
  end if;
end;
$$;
revoke all on function public.set_user_block_v1(uuid,boolean) from public, anon;
grant execute on function public.set_user_block_v1(uuid,boolean) to authenticated;

-- The invoker can only see their own rows under RLS. Used before RPC pagination.
create function public.has_blocked_user_v1(p_user_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.user_blocks
    where blocker_user_id = auth.uid() and blocked_user_id = p_user_id);
$$;
revoke all on function public.has_blocked_user_v1(uuid) from public, anon;
grant execute on function public.has_blocked_user_v1(uuid) to authenticated;

create function public.guard_blocked_communication_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_buyer uuid; v_seller uuid;
begin
  if tg_table_name = 'conversations' then
    v_buyer := new.buyer_id; v_seller := new.seller_id;
  else
    select buyer_id, seller_id into v_buyer, v_seller from public.conversations where id = new.conversation_id;
  end if;
  if v_buyer is null or v_seller is null then return new; end if;
  -- BEFORE triggers run before RLS WITH CHECK. Reject outsiders before inspecting
  -- the pair so forged inserts cannot be used to probe third-party relationships.
  if auth.uid() is not null and auth.uid() not in (v_buyer, v_seller) then
    raise exception 'Communication unavailable' using errcode = '42501';
  end if;
  perform public.lock_block_pair_v1(v_buyer, v_seller);
  if exists(select 1 from public.user_blocks
    where (blocker_user_id = v_buyer and blocked_user_id = v_seller)
       or (blocker_user_id = v_seller and blocked_user_id = v_buyer)) then
    raise exception 'SHEDMO_INTERACTION_UNAVAILABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_blocked_communication_v1() from public, anon, authenticated;
create trigger conversations_block_guard before insert on public.conversations
for each row execute function public.guard_blocked_communication_v1();
create trigger messages_block_guard before insert on public.messages
for each row execute function public.guard_blocked_communication_v1();

-- Existing SELECT policies stay intact: reporting and historical conversation /
-- transaction access are preserved. No messages, favorites or listings are deleted.

-- Preserve existing nearby_listings ranking, ordering, filters and cursors.
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
    and not public.has_blocked_user_v1(l.seller_id)
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

-- Preserve existing search_marketplace_listings_v3 ranking, ordering, filters and cursors.
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
        and not public.has_blocked_user_v1(l.seller_id)
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

commit;

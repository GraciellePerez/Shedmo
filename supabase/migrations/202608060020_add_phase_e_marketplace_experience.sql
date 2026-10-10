-- Phase E marketplace experience. Additive only; financial and fulfillment tables are not modified.

create table public.marketplace_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  reviewee_id uuid not null references public.profiles(id) on delete restrict,
  direction text not null check (direction in ('buyer_to_seller', 'seller_to_buyer')),
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or (char_length(body) between 1 and 800 and body = btrim(body))),
  created_at timestamptz not null default now(),
  constraint marketplace_reviews_no_self_review check (reviewer_id <> reviewee_id),
  constraint marketplace_reviews_one_per_party unique (order_id, reviewer_id),
  constraint marketplace_reviews_one_per_direction unique (order_id, direction)
);

create index marketplace_reviews_reviewee_created_idx
  on public.marketplace_reviews (reviewee_id, created_at desc);

alter table public.marketplace_reviews enable row level security;
revoke all on table public.marketplace_reviews from public, anon, authenticated;
grant select on table public.marketplace_reviews to authenticated;

create policy marketplace_reviews_authenticated_read
  on public.marketplace_reviews for select to authenticated using (true);

create function public.submit_marketplace_review(
  p_order_id uuid,
  p_rating smallint,
  p_body text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_direction text;
  v_reviewee uuid;
  v_review_id uuid;
  v_body text := nullif(btrim(p_body), '');
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode = '22023', message = 'Rating must be between 1 and 5.';
  end if;
  if v_body is not null and char_length(v_body) > 800 then
    raise exception using errcode = '22023', message = 'Review is too long.';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception using errcode = 'P0002', message = 'Order unavailable.'; end if;
  if v_order.fulfillment_status <> 'completed' or v_order.completed_at is null then
    raise exception using errcode = '55000', message = 'Reviews require a completed transaction.';
  end if;
  if v_actor = v_order.buyer_id then
    v_direction := 'buyer_to_seller'; v_reviewee := v_order.seller_id;
  elsif v_actor = v_order.seller_id then
    v_direction := 'seller_to_buyer'; v_reviewee := v_order.buyer_id;
  else
    raise exception using errcode = '42501', message = 'Order unavailable.';
  end if;

  insert into public.marketplace_reviews(order_id, reviewer_id, reviewee_id, direction, rating, body)
  values (p_order_id, v_actor, v_reviewee, v_direction, p_rating, v_body)
  returning id into v_review_id;
  return v_review_id;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'This transaction has already been reviewed.';
end;
$$;

revoke all on function public.submit_marketplace_review(uuid, smallint, text) from public;
grant execute on function public.submit_marketplace_review(uuid, smallint, text) to authenticated;

create function public.get_profile_reviews(p_profile_id uuid, p_limit integer default 30, p_offset integer default 0)
returns table (
  review_id uuid, reviewer_id uuid, reviewer_name text, reviewer_avatar_url text,
  direction text, rating smallint, body text, created_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select r.id, r.reviewer_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Marketplace member'),
    p.avatar_url, r.direction, r.rating, r.body, r.created_at
  from public.marketplace_reviews r
  join public.profiles p on p.id = r.reviewer_id
  where r.reviewee_id = p_profile_id
  order by r.created_at desc, r.id desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;

revoke all on function public.get_profile_reviews(uuid, integer, integer) from public;
grant execute on function public.get_profile_reviews(uuid, integer, integer) to authenticated;

create function public.get_public_seller_profile_v2(p_seller_id uuid)
returns table (
  seller_id uuid, display_name text, username text, avatar_url text, bio text,
  city text, state text, member_since timestamptz, active_listing_count bigint,
  sold_listing_count bigint, verified_sales_count bigint, average_rating numeric, total_reviews bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.display_name, p.username, p.avatar_url, p.bio, p.city, p.state, p.created_at,
    (select count(*) from public.listings l where l.seller_id = p.id and l.status = 'active'),
    (select count(*) from public.listings l where l.seller_id = p.id and l.status = 'sold'),
    (select count(*) from public.orders o where o.seller_id = p.id and o.fulfillment_status = 'completed' and o.completed_at is not null),
    (select round(avg(r.rating)::numeric, 2) from public.marketplace_reviews r where r.reviewee_id = p.id and r.direction = 'buyer_to_seller'),
    (select count(*) from public.marketplace_reviews r where r.reviewee_id = p.id and r.direction = 'buyer_to_seller')
  from public.profiles p where p.id = p_seller_id
$$;

revoke all on function public.get_public_seller_profile_v2(uuid) from public;
grant execute on function public.get_public_seller_profile_v2(uuid) to authenticated;

create table public.recently_viewed_listings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index recently_viewed_user_time_idx on public.recently_viewed_listings(user_id, viewed_at desc);
alter table public.recently_viewed_listings enable row level security;
revoke all on table public.recently_viewed_listings from public, anon, authenticated;
grant select, insert, update, delete on table public.recently_viewed_listings to authenticated;
create policy recently_viewed_own_read on public.recently_viewed_listings for select to authenticated using (user_id = auth.uid());
create policy recently_viewed_own_insert on public.recently_viewed_listings for insert to authenticated with check (user_id = auth.uid());
create policy recently_viewed_own_update on public.recently_viewed_listings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy recently_viewed_own_delete on public.recently_viewed_listings for delete to authenticated using (user_id = auth.uid());

create function public.record_recent_listing_view(p_listing_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required.'; end if;
  if not exists (select 1 from public.listings where id = p_listing_id and status = 'active') then return; end if;
  insert into public.recently_viewed_listings(user_id, listing_id, viewed_at)
  values (v_actor, p_listing_id, now())
  on conflict (user_id, listing_id) do update set viewed_at = excluded.viewed_at;
  delete from public.recently_viewed_listings r where r.user_id = v_actor and r.listing_id in (
    select listing_id from public.recently_viewed_listings where user_id = v_actor
    order by viewed_at desc offset 30
  );
end $$;
revoke all on function public.record_recent_listing_view(uuid) from public;
grant execute on function public.record_recent_listing_view(uuid) to authenticated;

create table public.marketplace_notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('new_message','order_placed','shipment','pickup_ready','pickup_completed','review_reminder','payout_completed')),
  order_id uuid references public.orders(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);
create index marketplace_notification_events_pending_idx on public.marketplace_notification_events(created_at) where dispatched_at is null;
alter table public.marketplace_notification_events enable row level security;
revoke all on table public.marketplace_notification_events from public, anon, authenticated;
grant all on table public.marketplace_notification_events to service_role;

comment on table public.marketplace_notification_events is 'Service-role-only notification outbox; Phase E does not deliver push notifications from this table.';

create function public.search_marketplace_listings_v2(
  p_query text default null, p_category text default null, p_condition text default null,
  p_min_price numeric default null, p_max_price numeric default null,
  p_latitude double precision default null, p_longitude double precision default null,
  p_radius_miles double precision default null, p_fulfillment text default 'all',
  p_sort text default 'newest', p_limit integer default 21,
  p_cursor_created_at timestamptz default null, p_cursor_id uuid default null,
  p_cursor_price numeric default null, p_cursor_distance double precision default null
)
returns table (listing_id uuid, distance_miles double precision, cursor_created_at timestamptz, cursor_price numeric)
language plpgsql security invoker set search_path = '' as $$
begin
  if p_fulfillment not in ('all', 'pickup', 'shipping') then raise exception 'Unsupported fulfillment filter'; end if;
  return query
  select s.listing_id, s.distance_miles, s.cursor_created_at, s.cursor_price
  from public.search_marketplace_listings(
    p_query, p_category, p_condition, p_min_price, p_max_price, p_latitude, p_longitude,
    p_radius_miles, p_sort, 50, p_cursor_created_at,
    p_cursor_id, p_cursor_price, p_cursor_distance
  ) s
  join public.listings l on l.id = s.listing_id
  where p_fulfillment = 'all'
    or (p_fulfillment = 'pickup' and l.pickup_available)
    or (p_fulfillment = 'shipping' and l.shipping_available)
  limit p_limit;
end $$;
revoke all on function public.search_marketplace_listings_v2(text,text,text,numeric,numeric,double precision,double precision,double precision,text,text,integer,timestamptz,uuid,numeric,double precision) from public;
grant execute on function public.search_marketplace_listings_v2(text,text,text,numeric,numeric,double precision,double precision,double precision,text,text,integer,timestamptz,uuid,numeric,double precision) to authenticated;

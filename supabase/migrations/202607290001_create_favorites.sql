-- Persistent listing favorites. Apply after the listings migration.

create table public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index favorites_user_created_idx on public.favorites (user_id, created_at desc);
create index favorites_listing_idx on public.favorites (listing_id);

alter table public.favorites enable row level security;

-- Private favorite records are readable only by their authenticated owner.
create policy "Users read only their own favorites"
on public.favorites for select to authenticated
using (user_id = auth.uid());

-- The composite primary key makes inserts idempotent, while this policy prevents
-- a caller from creating a favorite for another user.
create policy "Users insert only their own favorites"
on public.favorites for insert to authenticated
with check (user_id = auth.uid());

-- Users can remove only their own favorite records.
create policy "Users delete only their own favorites"
on public.favorites for delete to authenticated
using (user_id = auth.uid());

grant select, insert, delete on table public.favorites to authenticated;

-- Active listings remain public; owners retain all statuses; favoriting users
-- retain read access to sold items so Saved Items can label them SOLD.
-- Archived/expired items stay hidden from other users. Deleting a listing
-- cascade-deletes its favorite records.
drop policy if exists "Public reads active listings; owners read their listings"
on public.listings;

create policy "Read active owned or favorited sold listings"
on public.listings for select
using (
  status = 'active'
  or seller_id = auth.uid()
  or (
    status = 'sold'
    and exists (
      select 1 from public.favorites f
      where f.listing_id = listings.id and f.user_id = auth.uid()
    )
  )
);

drop policy if exists "Public reads active listing images; owners read all"
on public.listing_images;

create policy "Read images for active owned or favorited sold listings"
on public.listing_images for select
using (
  exists (
    select 1 from public.listings l
    where l.id = listing_id
      and (
        l.status = 'active'
        or l.seller_id = auth.uid()
        or (
          l.status = 'sold'
          and exists (
            select 1 from public.favorites f
            where f.listing_id = l.id and f.user_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists "Read active listing photos or own photos"
on storage.objects;

create policy "Read active owned or favorited sold listing photos"
on storage.objects for select
using (
  bucket_id = 'listing-images'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.listing_images li
      join public.listings l on l.id = li.listing_id
      where li.storage_path = name
        and (
          l.status = 'active'
          or l.seller_id = auth.uid()
          or (
            l.status = 'sold'
            and exists (
              select 1 from public.favorites f
              where f.listing_id = l.id and f.user_id = auth.uid()
            )
          )
        )
    )
  )
);

-- Phase 3: marketplace listings and private listing-photo storage.
-- Apply after 202607280001_create_profiles.sql.

create extension if not exists pgcrypto;

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text not null check (char_length(btrim(description)) between 10 and 5000),
  brand text,
  price numeric(12,2) not null check (price >= 0),
  category text not null check (category in (
    'tools', 'auto_parts', 'tool_storage', 'equipment', 'marine',
    'outdoor_power', 'shop_equipment', 'supplies'
  )),
  condition text not null check (condition in ('new', 'like_new', 'good', 'fair', 'for_parts')),
  status text not null default 'active' check (status in ('draft', 'active', 'sold', 'expired', 'archived')),
  city text check (city is null or char_length(btrim(city)) between 2 and 80),
  state text check (state is null or char_length(btrim(state)) between 2 and 40),
  latitude double precision,
  longitude double precision,
  pickup_available boolean not null default false,
  shipping_available boolean not null default false,
  shipping_price numeric(10,2) check (
    (shipping_available and shipping_price is not null and shipping_price >= 0)
    or (not shipping_available and shipping_price is null)
  ),
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (listing_id, storage_path),
  unique (listing_id, sort_order)
);

create index listings_seller_idx on public.listings (seller_id);
create index listings_status_idx on public.listings (status);
create index listings_category_idx on public.listings (category);
create index listings_created_idx on public.listings (created_at desc);
create index listings_price_idx on public.listings (price);
create index listing_images_listing_sort_idx on public.listing_images (listing_id, sort_order);

create or replace function public.set_listings_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger listings_set_updated_at
before update on public.listings
for each row execute function public.set_listings_updated_at();

alter table public.listings enable row level security;
alter table public.listing_images enable row level security;

-- Marketplace visitors may read active inventory; owners may also read every
-- status of their own listings.
create policy "Public reads active listings; owners read their listings"
on public.listings for select
using (status = 'active' or seller_id = auth.uid());

-- An authenticated seller can only create rows owned by their auth user.
create policy "Sellers create their own listings"
on public.listings for insert to authenticated
with check (seller_id = auth.uid());

-- A seller can only update rows they own and cannot transfer ownership.
create policy "Sellers update their own listings"
on public.listings for update to authenticated
using (seller_id = auth.uid())
with check (seller_id = auth.uid());

-- A seller can only delete rows they own.
create policy "Sellers delete their own listings"
on public.listings for delete to authenticated
using (seller_id = auth.uid());

-- Image metadata is readable for active listings and by the listing owner.
create policy "Public reads active listing images; owners read all"
on public.listing_images for select
using (
  exists (
    select 1 from public.listings l
    where l.id = listing_id
      and (l.status = 'active' or l.seller_id = auth.uid())
  )
);

-- Image metadata can only be attached to a listing owned by the caller.
create policy "Sellers create image metadata for their listings"
on public.listing_images for insert to authenticated
with check (
  exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
);

-- Reordering/replacing image metadata is restricted to the listing owner.
create policy "Sellers update image metadata for their listings"
on public.listing_images for update to authenticated
using (
  exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
)
with check (
  exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
);

-- Image metadata deletion is restricted to the listing owner.
create policy "Sellers delete image metadata for their listings"
on public.listing_images for delete to authenticated
using (
  exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-images',
  'listing-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Private downloads are allowed for active listing photos and all owner photos.
create policy "Read active listing photos or own photos"
on storage.objects for select
using (
  bucket_id = 'listing-images'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.listing_images li
      join public.listings l on l.id = li.listing_id
      where li.storage_path = name and l.status = 'active'
    )
  )
);

-- Uploads must use {auth.uid()}/{listingId}/{uniqueName} and target a listing
-- owned by the caller.
create policy "Sellers upload photos to owned listing folders"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.listings l
    where l.id::text = (storage.foldername(name))[2] and l.seller_id = auth.uid()
  )
);

-- Owners may replace objects only inside their own listing folders.
create policy "Sellers update their listing photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'listing-images'
  and owner_id = auth.uid()::text
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Owners may delete only objects uploaded under their own user prefix.
create policy "Sellers delete their listing photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'listing-images'
  and owner_id = auth.uid()::text
  and (storage.foldername(name))[1] = auth.uid()::text
);

grant select on table public.listings, public.listing_images to anon, authenticated;
grant insert, update, delete on table public.listings, public.listing_images to authenticated;

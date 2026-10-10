-- Local only: requires separate approval before remote application.
-- No row updates/deletes. Existing malformed associations become unreadable.
begin;

create function public.listing_image_path_matches_v1(p_path text, p_seller uuid, p_listing uuid)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(
    array_length(string_to_array(p_path, '/'), 1) = 3
    and split_part(p_path, '/', 1) = p_seller::text
    and split_part(p_path, '/', 2) = p_listing::text
    and split_part(p_path, '/', 3) not in ('', '.', '..')
    and position(chr(92) in p_path) = 0,
    false);
$$;
revoke all on function public.listing_image_path_matches_v1(text,uuid,uuid) from public;
grant execute on function public.listing_image_path_matches_v1(text,uuid,uuid) to anon, authenticated, service_role;

-- Definer avoids a policy cycle: listing_images -> storage.objects -> listing_images.
-- It returns only a boolean, requires the caller to own the listing, and checks
-- the actual object's bucket, canonical folder association, and owner_id.
create function public.can_attach_listing_image_v1(p_listing uuid, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.listings l
    join storage.objects o on o.bucket_id = 'listing-images' and o.name = p_path
    where l.id = p_listing and l.seller_id = auth.uid()
      and o.owner_id = l.seller_id::text
      and public.listing_image_path_matches_v1(o.name, l.seller_id, l.id)
  );
$$;
revoke all on function public.can_attach_listing_image_v1(uuid,text) from public, anon;
grant execute on function public.can_attach_listing_image_v1(uuid,text) to authenticated;

-- Restrictive policies AND with existing ownership policies, never broaden them.
create policy listing_images_authorized_object_insert on public.listing_images
as restrictive for insert to authenticated
with check (public.can_attach_listing_image_v1(listing_id, storage_path));

create policy listing_images_authorized_object_update on public.listing_images
as restrictive for update to authenticated
using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()))
with check (public.can_attach_listing_image_v1(listing_id, storage_path));

-- Validate the row being read, not just a potentially forged metadata reference.
-- Existing permissive policies still decide public/owner/favorite/conversation/
-- order access. Other buckets pass through unchanged. Owner reads before the
-- metadata insert remain available for the existing upload workflow.
create policy listing_photos_require_authorized_relationship on storage.objects
as restrictive for select to anon, authenticated
using (
  bucket_id <> 'listing-images'
  or exists (
    select 1 from public.listings l
    where public.listing_image_path_matches_v1(objects.name, l.seller_id, l.id)
      and objects.owner_id = l.seller_id::text
      and (
        l.seller_id = auth.uid()
        or exists (
          select 1 from public.listing_images li
          where li.listing_id = l.id and li.storage_path = objects.name
        )
      )
  )
);

-- DELETE retains the existing seller-only metadata/object policies: removing
-- one's own malformed reference must remain possible, without deleting another
-- owner's object. No data cleanup is performed by this migration.
commit;

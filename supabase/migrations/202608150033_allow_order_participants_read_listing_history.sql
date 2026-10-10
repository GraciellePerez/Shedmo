-- Keep immutable order history connected to its original listing without
-- making inactive inventory public or writable.
create policy "Order participants read historical listings"
on public.listings for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.listing_id = listings.id
      and auth.uid() in (o.buyer_id, o.seller_id)
  )
);

create policy "Order participants read historical listing images"
on public.listing_images for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.listing_id = listing_images.listing_id
      and auth.uid() in (o.buyer_id, o.seller_id)
  )
);

create policy "Order participants read historical listing photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'listing-images'
  and exists (
    select 1
    from public.listing_images li
    join public.orders o on o.listing_id = li.listing_id
    where li.storage_path = name
      and auth.uid() in (o.buyer_id, o.seller_id)
  )
);

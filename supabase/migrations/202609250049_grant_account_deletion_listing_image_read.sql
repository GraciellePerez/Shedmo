-- Account deletion reads listing-image paths before trusted storage cleanup.
-- Client grants, RLS policies, and mutation privileges remain unchanged.
-- Repeating this grant is safe; no grant option is conferred.
grant select on table public.listing_images to service_role;

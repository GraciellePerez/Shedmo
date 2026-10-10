-- Account deletion removes listing-image metadata after trusted storage cleanup.
-- Client grants, RLS policies, and other privileges remain unchanged.
-- Repeating this grant is safe; no grant option is conferred.
grant delete on table public.listing_images to service_role;

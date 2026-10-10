-- The trusted Admin Users queue computes public marketplace rating summaries.
-- Browser permissions and review mutation privileges remain unchanged.
grant select (rating, reviewee_id, direction)
on table public.marketplace_reviews
to service_role;

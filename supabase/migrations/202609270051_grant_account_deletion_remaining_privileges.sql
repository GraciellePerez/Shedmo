-- Complete the audited service-role grants for account-deletion cleanup.
-- Client grants, RLS policies, and triggers remain unchanged.
-- Repeating these grants is safe; no grant option is conferred.
grant update (
  display_name, username, bio, avatar_url, city, state, postal_code,
  account_suspended_at, account_suspended_by, staff_sell_restricted
) on table public.profiles to service_role;

grant select (sender_id), update (body, deleted_at)
on table public.messages to service_role;

grant select (reviewer_id), update (body)
on table public.marketplace_reviews to service_role;

grant update (actor_id), delete
on table public.notifications to service_role;

grant update (user_id)
on table public.marketplace_analytics_events to service_role;

grant update (user_id)
on table public.marketplace_operational_errors to service_role;

grant select (user_id), delete
on table public.favorites to service_role;

grant select (user_id), delete
on table public.recently_viewed_listings to service_role;

grant select (user_id), delete
on table public.conversation_reads to service_role;

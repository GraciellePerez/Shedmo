-- The push Edge Function authenticates with the server-side service-role key,
-- but bypassing RLS does not replace the underlying SQL table privileges.
-- Keep client roles unchanged and grant only the direct operations used by the
-- trusted push-delivery implementation.
grant select on table public.notifications to service_role;
grant select, update on table public.push_tokens to service_role;
grant select, update on table public.push_delivery_claims to service_role;

-- Verification: all values must be true after this migration is applied.
-- These checks are read-only and intentionally cover only the granted actions.
select
  has_table_privilege(
    'service_role',
    'public.notifications',
    'SELECT'
  ) as service_role_can_select_notifications,
  has_table_privilege(
    'service_role',
    'public.push_tokens',
    'SELECT'
  ) as service_role_can_select_push_tokens,
  has_table_privilege(
    'service_role',
    'public.push_tokens',
    'UPDATE'
  ) as service_role_can_update_push_tokens,
  has_table_privilege(
    'service_role',
    'public.push_delivery_claims',
    'SELECT'
  ) as service_role_can_select_push_delivery_claims,
  has_table_privilege(
    'service_role',
    'public.push_delivery_claims',
    'UPDATE'
  ) as service_role_can_update_push_delivery_claims;

-- Verification: no client role receives any new direct mutation privilege.
-- The SELECT results reflect the existing migrations: authenticated may read
-- only its own push_tokens through RLS, while claims remain service-only.
select
  role_name,
  has_table_privilege(
    role_name,
    'public.notifications',
    'INSERT'
  ) as can_insert_notifications,
  has_table_privilege(
    role_name,
    'public.notifications',
    'UPDATE'
  ) as can_update_notifications,
  has_table_privilege(
    role_name,
    'public.push_tokens',
    'INSERT'
  ) as can_insert_push_tokens,
  has_table_privilege(
    role_name,
    'public.push_tokens',
    'UPDATE'
  ) as can_update_push_tokens,
  has_table_privilege(
    role_name,
    'public.push_tokens',
    'DELETE'
  ) as can_delete_push_tokens,
  has_table_privilege(
    role_name,
    'public.push_delivery_claims',
    'SELECT'
  ) as can_select_push_delivery_claims,
  has_table_privilege(
    role_name,
    'public.push_delivery_claims',
    'INSERT'
  ) as can_insert_push_delivery_claims,
  has_table_privilege(
    role_name,
    'public.push_delivery_claims',
    'UPDATE'
  ) as can_update_push_delivery_claims,
  has_table_privilege(
    role_name,
    'public.push_delivery_claims',
    'DELETE'
  ) as can_delete_push_delivery_claims
from (
  values ('anon'), ('authenticated')
) as client_roles(role_name);

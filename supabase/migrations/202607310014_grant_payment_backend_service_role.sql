-- Phase C trusted payment backends require explicit table privileges in
-- addition to service_role's RLS bypass. Keep browser-facing roles unchanged.

grant select, insert, update
on table public.seller_payment_accounts
to service_role;

grant select, insert, update
on table public.stripe_webhook_events
to service_role;

-- Manual verification after applying this migration:
--
-- select table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'service_role'
--   and table_schema = 'public'
--   and table_name in (
--     'seller_payment_accounts',
--     'stripe_webhook_events',
--     'orders',
--     'payments',
--     'order_status_history'
--   )
-- order by table_name, privilege_type;
--
-- select
--   has_schema_privilege('service_role', 'public', 'USAGE')
--     as service_role_has_public_usage,
--   has_table_privilege(
--     'service_role',
--     'public.seller_payment_accounts',
--     'SELECT, INSERT, UPDATE'
--   ) as service_role_has_seller_account_access,
--   has_table_privilege(
--     'service_role',
--     'public.stripe_webhook_events',
--     'SELECT, INSERT, UPDATE'
--   ) as service_role_has_webhook_event_access,
--   has_table_privilege(
--     'service_role',
--     'public.seller_payment_accounts',
--     'DELETE'
--   ) as service_role_has_seller_account_delete,
--   has_table_privilege(
--     'service_role',
--     'public.stripe_webhook_events',
--     'DELETE'
--   ) as service_role_has_webhook_event_delete;

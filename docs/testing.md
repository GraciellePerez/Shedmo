# Testing and environment isolation

Run `npm run typecheck`, `npm run lint -- --no-cache`, and `npm test` for the client and Node-compatible regressions. `npm run test:security` selects authorization, blocking, moderation, storage, and account-deletion tests. `npm run test:deno` requires Deno and runs financial helper and report-inspection tests.

## Database fixtures

PGlite tests execute PostgreSQL migrations and security logic in disposable in-memory fixtures. They cover ownership, grants, RLS, transactions, and failure/retry behavior where supported. Simulated Auth and Storage APIs do not establish compatibility with an installed Supabase stack or a deployed function bundle.

The archived migration under `docs/retired-migrations/` is retained because a trusted-shipment regression reads it. It is not an active migration.

## Local Supabase runtime

The opt-in account-deletion test creates and deletes disposable accounts. Prepare a dedicated local Supabase stack with the reviewed migrations and current `delete-account` function. Use its local client and service-role credentials only. Provide these variables to the test process separately from the mobile environment:

- `SHEDMO_DELETION_TEST_URL`: a loopback API URL.
- `SHEDMO_DELETION_TEST_ANON_KEY`: the local client key.
- `SHEDMO_DELETION_TEST_SERVICE_ROLE_KEY`: the local server-only key.

```sh
node --test scripts/tests/account-deletion-runtime.test.mjs
```

Without configuration the test skips. Its URL guard rejects hosted backends. Do not remove that guard, copy hosted credentials into local fixtures, or use existing accounts as test data.

A Supabase local stack requires Docker and a separately prepared CLI configuration. The checked-in function configuration is not a complete local stack definition. Bind exposed services to loopback and verify the actual published ports; an isolated directory or named network alone does not establish isolation. Never link the test stack to a hosted project. Keep fixture manifests, logs, identifiers, and captures outside public tracking.

## Device and provider validation

Use synthetic accounts for authentication callbacks, listing photos, messaging, local sale confirmation, blocking, moderation, and account deletion. Camera, notifications, permissions, unreliable networks, and iOS/Android layouts require device checks. Stripe flows require test-mode provider configuration and webhook verification. Local-only defaults do not enable those flows.

Record cases, expected behavior, sanitized results, and limitations. Do not include account UUIDs, message bodies, payment records, tokens, personal photos, or private deployment details in public evidence.

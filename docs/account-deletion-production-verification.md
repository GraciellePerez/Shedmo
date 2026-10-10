# Account-deletion validation checklist

This reusable checklist complements [the deletion design](account-deletion-fix.md). It contains no project-specific deployment record and makes no claim about a currently deployed backend. Use a dedicated local environment and synthetic accounts.

## Schema and function checks

- Confirm the reviewed migration sequence includes migration 054 and the current deletion function/helpers.
- Reject unauthenticated deletion requests before any cleanup.
- Verify the finalizer functions are owned by the trusted database role and have no API-role EXECUTE grant.
- Verify finalization requires the private marker and the first Auth soft-deletion transition, with the expected Auth role, nested trigger, and current-transaction row checks.
- Confirm cleanup only clears permitted notification actor references; other identity fields remain protected.
- Confirm unresolved order/local-sale checks, table RLS flags, policies, and column grants retain their intended behavior.
- Keep service credentials server-side and restrict errors to sanitized stage/code pairs.

## Disposable-account lifecycle

1. Create synthetic account A through the normal signup flow; confirm required email verification and successful sign-in.
2. Delete through Settings, requiring `deleted: true`, a success alert, and session clearing.
3. In a fresh session verify old password login and refresh fail, the Auth row is soft-deleted, and retained profile fields are anonymized.
4. Recreate account B using the same synthetic credentials and verify a fresh identity.
5. Create an actor notification involving a second disposable account using ordinary allowed app activity. Avoid pending orders or sale confirmations.
6. Delete B and repeat the authentication/profile checks. Verify the notification actor reference is cleared without changing other identity fields.
7. Exercise previously partial deletion state and authorized retries in the isolated environment. Remove only disposable fixtures afterward.

Use `node --test scripts/tests/account-deletion-runtime.test.mjs` with the local-only variables described in [testing.md](testing.md). Missing configuration skips the test. Preserve its hosted-URL rejection.

## Failure and retention limits

Local PostgreSQL regressions simulate storage, cleanup, and late Auth failures to verify rollback and retry. A running Supabase Auth service still needs its own validation. Storage removals cannot roll back with the database transaction. A lost response may look like failure after deletion committed. Existing stateless access JWTs can remain valid until expiry; immediate global revocation is not claimed.

Transactions, safety references, and reported-image evidence may be retained intentionally. Validate those requirements against policy rather than promising complete record erasure. Physical-device success/session clearing must also be verified.

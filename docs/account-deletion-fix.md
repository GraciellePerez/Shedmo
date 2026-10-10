# Account deletion investigation

The earlier implementation had a deterministic, data-dependent failure at
`notifications.update({ actor_id: null })`: the original
`prevent_notification_identity_change` trigger rejects every actor change with
`P0001: Only notification read state may be changed.` It also rejects trusted
service-role cleanup. Because profile anonymization and the other updates were
independent parallel PostgREST transactions, profile anonymization could commit
before that error was checked. The handler then returned HTTP 500 without ever
calling `auth.admin.deleteUser(user.id, true)`. Password sign-in remained possible.

This error reproduces locally with the exact original notification trigger and
one actor notification. There is no deletion-attempt counter or email-based
retry guard. The private marker is keyed by Auth UUID and its insert is
`ON CONFLICT DO NOTHING`. Recreated accounts have different UUIDs. Retry markers
prevent content restoration but do not disable Auth credentials. The first
attempt can work when no matching actor notification exists; a later account
can fail when one does. Migrations 049-051 supply service-role grants, and 053 supplies chat cleanup reads.
Those grants alone cannot bypass the notification identity trigger.

Migration 054 narrowly permits a service-authorized actor reference to become
NULL only when the actor has a private deletion marker. Every other identity
field remains immutable. Client grants and RLS policies are unchanged.

All database cleanup moves to a non-callable SECURITY DEFINER trigger on Auth's
first `deleted_at` transition, only for accounts with a deletion marker. This
uses Supabase's existing soft deletion, preserving profile UUIDs and completed
transaction, review, financial and safety references. Supabase Auth performs
soft deletion, identity cleanup and session removal inside one database
transaction; any failure rolls back the trigger's anonymization as well. The
trigger rechecks the existing unresolved activity rules. The production-compatible
cleanup check requires the Auth DB role, a nested trigger, a private marker, and
an Auth row written in the same transaction. It alters no connection settings.
The trigger cannot be invoked by clients or directly by the service role.

Cleanup retains the existing behavior for listing statuses/text/photos,
messages, review bodies, actor notifications, analytics, operational errors,
feedback, staff roles, push tokens, favorites, recent views, read cursors and the
notification outbox. Reported chat photo evidence remains retained. The Edge
Function still validates all Storage paths and removes Storage objects before
requesting Auth deletion. It reports only sanitized error stage/code pairs.
The client additionally requires `{ deleted: true }` before showing success.

Storage is outside the Auth transaction: earlier object removals cannot be
rolled back. The durable marker and retained metadata permit repeating cleanup
after failure; a newly failed operation leaves the profile identity and Auth
deletion state unchanged, rather than newly anonymizing a sign-in-capable user.
An older already-anonymized partial account can retry with its existing marker.
A successful deletion retains its irreversible Auth soft-deletion semantics.
If the success response is lost after commit, the client may report a network
failure even though deletion completed; it does not falsely report success.

The in-memory regression runs the actual Edge handler and real SQL triggers,
including unique usernames and an Auth DB role with no PostgREST JWT claims.
It covers two fresh UUIDs, the second with actor notifications, repeated cleanup,
reported photo retention, storage failure, cleanup failure, late Auth failure,
transaction rollback, and retries. Storage and Auth HTTP APIs are simulated.

The real sign-in regression is opt-in and restricted to a local Supabase stack:
set `SHEDMO_DELETION_TEST_URL`, `SHEDMO_DELETION_TEST_ANON_KEY`, and
`SHEDMO_DELETION_TEST_SERVICE_ROLE_KEY`, then run
`node --test scripts/tests/account-deletion-runtime.test.mjs`. It creates a
disposable email account, deletes it, verifies password login/session refresh
fail and the profile is anonymized, recreates the same email/password with a
fresh UUID, and repeats. This requires migration 054 and the revised Edge
Function installed on that isolated stack. See account-deletion-production-verification.md for a reusable validation checklist.
This design document does not establish current deployment or device-test status.

For runtime validation, verify the installed migrations and runtime Auth version
on an isolated Supabase environment, exercise actor notifications and previously
partial accounts, then demonstrate the flow on a physical iPhone. Existing
access JWTs are stateless until expiry; this change preserves the existing
deletion content guards and does not claim global immediate JWT revocation.

## Validation

Run the current type checks, lint, and regression commands documented in README.md.
The local-only runtime test requires a separately configured Supabase stack.
Recorded development results are not a substitute for current Auth and device validation.

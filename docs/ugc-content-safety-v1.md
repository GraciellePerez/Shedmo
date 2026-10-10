# V1 content safety implementation

This document describes the bounded text-safety design. Later report moderation and private chat-photo handling are documented in v1-moderation-operations.md and chat-image-attachments-v1.md. Source availability does not establish deployment or launch compliance.

## Existing policy and enforcement map

The source of policy is `src/features/legal/legalDocuments.ts`, particularly Marketplace Rules / Prohibited Items. The existing rules prohibit illegal/stolen goods, unlawful restricted goods, controlled substances, counterfeits, hazardous/recalled goods, exposed private information/credentials, fraud, unauthorized images, threats/harassment/hate/sexual harassment, impersonation, spam and circumvention. Off-platform arrangements are not automatically prohibited. Terms also require lawful use and permit moderation. No legal text was changed.

| Surface | Existing rules relevant here | New database enforcement |
| --- | --- | --- |
| Listing title, description, category, brand | Prohibited goods, fraud, threats, private information | INSERT and changed-text UPDATE; publication of draft or archived/expired content |
| Message body | Threats, harassment, prohibited transactions, exposed credentials | INSERT and changed-body UPDATE, including direct API writes |
| Review body | Threats, harassment, exposed credentials | Table trigger beneath both checkout and confirmed-local-sale review RPCs |
| Profile display name, username, bio | Threats, harassment, impersonation, exposed credentials | INSERT and changed-text UPDATE, including the auth-created profile |
| Listing photos | Unauthorized images, private information, prohibited content | New uploader reminder/rules link; existing reports and authorized staff review. No automated image classification |

The versioned rules recognize a small set of explicit threats/self-harm harassment, explicit offers of named stolen/counterfeit goods or illegal drugs, offers/requests for child sexual abuse material, private-key headers and selected secret-key formats. They normalize case, punctuation, Unicode width and common invisible separators. They do not blacklist standalone words such as gun, kill, drug, replica or stolen. These rules do not recognize every policy violation, language or obfuscation, and cannot reliably interpret quotations, negation, humor or context. Ambiguous content that does not match remains subject to the existing report-and-review workflow; no automatic quarantine is claimed.

## Migration and bypass protection

`supabase/migrations/202609140046_add_ugc_text_safety.sql` creates:

- `ugc_text_is_prohibited_v1(text)`: immutable, invoker-rights, pure predicate with empty search path. EXECUTE is granted to anon/authenticated/service_role; it reads no user records and stores/logs nothing.
- `enforce_ugc_text_safety_v1()`: invoker-rights trigger function, empty search path, no client EXECUTE grant.
- `listings_ugc_text_safety`, `messages_ugc_text_safety`, `reviews_ugc_text_safety`, `profiles_ugc_text_safety`: BEFORE INSERT OR UPDATE row triggers on `listings`, `messages`, `marketplace_reviews`, `profiles` respectively.

No policy, table column, storage bucket, historical migration or existing RPC definition changes. No data backfill, update or deletion. Rejected statements are atomic and leave previous content intact. Draft text is checked too. Unchanged text does not block unrelated history, moderation or account operations; unchanged reserved-to-active transitions remain compatible with reservation release. Archived/expired-to-active and draft-to-active transitions are checked. Existing legacy active content is not retroactively filtered.

Direct PostgREST writes, upserts and security-definer review RPCs still fire the table triggers. Client roles cannot disable triggers or replace the predicate. Privileged database administrators can always change database enforcement; this is not an administrator-proof control. Existing RLS, profile-column grants, participant checks, review eligibility, uniqueness, blocking and staff authorization remain responsible for access control.

Reversal is possible with a separately reviewed migration dropping the four named triggers, then the trigger function and predicate, without CASCADE. No user data restoration would be needed. Do not modify an applied historical migration to roll back. Rollback removes the new filtering protection.

## User experience

Listing creation/editing, both review screens, profile editing and messaging translate the safety marker to: “This content can't be posted because it violates Shedmo's Marketplace Rules.” An alert links to the existing `/settings/prohibited-items` route. Message drafts and edit forms remain in place after rejection. No SQL details or matching rule is shown or logged by this layer.

Signup-created profile writes are also guarded. Supabase Auth can mask a trigger rejection as a generic signup database failure; the existing auth error sanitizer provides a generic non-technical message in that case, not a specific policy diagnosis. No authentication flow was changed. This needs device/API verification before release.

## Practical image/report workflow and remaining gaps

No existing image-content classifier or approval queue was found. MIME/size checks and storage ownership are not content classification. No paid provider, ML service, third-party disclosure or new storage policy was added.

The uploader reminder now asks for authorized photos without private or prohibited content. Users can report listings/sellers or received messages using existing controls, including after blocking. Report descriptions deliberately remain unfiltered so users can submit evidence. The existing staff queue supports Review/Resolve/Dismiss and resolution notes; authorized staff can hide eligible listings and apply existing account restrictions. This is reactive mitigation, not pre-publication image approval.

Current report inspection and suppression support listings, messages, reviews, and profiles. See [moderation design](v1-moderation-operations.md) for authorization, restoration, private evidence retention, and signed-link limits. This reactive workflow does not provide automated image classification or pre-publication approval.

Staff response coverage, hosted-service validation, and multilingual/contextual abuse handling remain separate release concerns. The bounded text filter alone does not establish complete safety coverage.

## Validation scope

`scripts/tests/ugc-content-safety.test.mjs` executes the new migration in ephemeral PGlite PostgreSQL with existing messaging, blocking, reporting, review RPCs, staff moderation and profile privacy migration 045. It checks normal language, prohibited direct writes and edits, both review paths, authorization preservation, legacy lifecycle behavior, and client error wiring. The isolated fixture models relevant base-table fields and RLS; it is not a full Supabase Auth/PostgREST or physical-device test. No remote migration, remote write, build, deployment, commit or push is part of validation.

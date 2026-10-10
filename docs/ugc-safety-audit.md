# Shedmo V1 blocking implementation and UGC audit

Historical design review from September 13, 2026. Later text-safety, report-moderation, and chat-image work is described in ugc-content-safety-v1.md and v1-moderation-operations.md. This document is not a current deployment or release assessment.

## Database status: PENDING APPROVAL

`supabase/migrations/202609130043_add_user_blocking.sql` is required and **created locally, NOT APPLIED to Supabase**. Its SQL was executed only in disposable in-memory PGlite regression fixtures. Blocking is not live until the migration is approved and applied and the app changes are released. No remote action is authorized by this report.

The migration creates `user_blocks(blocker_user_id, blocked_user_id, created_at)`, a composite primary key, profile foreign keys with cascade on actual profile deletion, a self-block constraint, and owner-only SELECT/INSERT/DELETE policies. Authenticated users cannot UPDATE block records, alter someone else's records, or enumerate another user's list. The mutation RPC derives the blocker from `auth.uid()` and handles duplicate block/unblock requests idempotently. Private trigger functions have no client EXECUTE grant.

New conversation and message INSERT triggers reject communication in either direction when either participant has blocked the other. Pair-level transaction locks serialize block changes and message/conversation insertion. Outsider inserts are rejected before checking another pair's block status. Existing participant/sender RLS remains intact. No listing, conversation, message, favorite, transaction, review, or account-deletion data is removed by blocking.

The existing nearby and search RPC definitions are preserved except for one block predicate before sorting and pagination. No ranking, cursor, distance, or other filtering algorithm was rewritten.

## User-visible behavior

- Block/Unblock buttons appear on the existing seller/profile screen and conversation screen. Both actions require confirmation. Self-block controls are omitted.
- Settings → Preferences → Blocked Users uses the existing `/settings/[slug]` route with `blocked-users`. It shows only the current user's blocks and supports confirmed unblocking, refresh, empty, loading, and error states.
- Blocking hides that seller from Home/featured inventory, Browse, Search, nearby results, Saved Items, seller grids, and recently viewed listings. Existing cached lists are filtered immediately after a successful block, and their pagination is refreshed. Ordinary listing-detail lookup also excludes blocked sellers.
- Direct discovery queries apply seller exclusions on the server before pagination. Saved Items uses an inner listing join when exclusions exist, so excluded sellers do not consume visible page slots. Favorites are retained and can reappear after unblocking.
- Hiding is directional: other users continue to see the seller. A block does not globally remove content.
- New messaging is bilateral: neither participant can send while either direction is blocked. The blocker's composer is replaced by an explanation; the other participant receives a generic unavailable-message error without disclosure of who blocked whom. Failed sends keep their draft. Existing conversations and their reporting controls remain readable. Historical listing joins used by messaging and transaction records are unchanged.
- Unblocking restores the blocker's discovery visibility. Messaging resumes only when neither side blocks the other. Unblocking does not recreate or erase historical records.
- The existing backend supports text messaging; the existing attachment placeholder was preserved.
- Until the migration exists, discovery retains its previous behavior for a missing block table, and attempted block actions clearly report that blocking is unavailable. Other block-query failures are not silently treated as an empty block list.

## Actual UGC safeguards

Apple's [App Review Guidelines §1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content), checked September 13, 2026, require objectionable-content filtering, reporting with timely responses, abusive-user blocking, and published contact information. The following is a code assessment, not verification of deployed services or staffing.

| Safeguard | Code evidence and remaining limit |
| --- | --- |
| Content filtering | No semantic objectionable-content filter or pre-publication approval workflow found. Format validation is present, detailed below. |
| Reporting | Listing, seller, and received-message ReportModal flows submit through `submit_content_report`. Private reports and duplicate handling exist. Tests confirm reporting still works after blocking. There is no dedicated review-report control. |
| User blocking | Implemented and tested locally, with authoritative database enforcement pending migration approval/application. Not yet a live safeguard. |
| Published contact | Legal screens publish and link `the in-app support contact`. Existing feedback submission also exists. The Help screen itself primarily provides FAQs and safety advice. |
| Staff review | Admin report queue and Review/Resolve/Dismiss operations exist behind staff authorization. |
| Responding to reports | Staff can update report status and record an internal resolution note. No reporter-facing response workflow or guaranteed response time was found. Timely monitoring and responses require owner verification. |
| Remove objectionable content | Staff can hide active/draft listings by archiving them. The operation rejects sold/reserved listings. No equivalent admin removal control was found for profile text/photos, individual messages, or reviews. Existing history/storage access is not a universal content takedown mechanism. |
| Restrict abusive accounts | Staff can set account suspension and selling restrictions. These enforce selling/checkout restrictions in the inspected code; this is not evidence of a global sign-in or messaging ban. Relationship blocking separately stops messaging between the affected users. |

## Filtering by content type

| Content | Existing validation | Objectionable-content coverage |
| --- | --- | --- |
| Listing titles | Trimmed text, 3–120 characters | No semantic filter found. |
| Listing descriptions | Trimmed text, 10–5,000 characters | No semantic filter found. |
| Listing images | Photo count, size and MIME checks; storage ownership | No image-content classification or pre-publication human review found. |
| Profile content | Username syntax/uniqueness; normal profile validation; avatar conversion/upload size checks (8 MB) and storage ownership | No semantic name/bio filter or avatar-content review found. |
| Messages | Authenticated sender and conversation membership; trimmed text length 1–2,000; new bilateral block enforcement | No semantic harassment, hate, sexual-content or scam filter found. |
| Reviews | Verified transaction/participant eligibility, rating 1–5, optional trimmed body up to 800 characters | No semantic filter or dedicated review moderation/removal UI found. |

No external moderation provider or additional third-party data sharing was introduced in this implementation.

## Smallest reasonable launch recommendation (not implemented)

Use the existing staff infrastructure for a server-enforced pending-review state for public listings, profile changes/photos, and reviews, including edits; keep unapproved images/content inaccessible publicly until staff approval. Add conservative, owner-reviewed server-side text rules at every text write entry point, including messages, with normalized matching, clear rejection feedback and escalation to staff. A simple keyword list alone does not cover images, context, obfuscation, or all abuse.

Extend staff controls to remove/hide each UGC type and provide a practical report-response workflow, including review reports. Assign staff coverage and a measurable response procedure before launch. This requires operational capacity; external provider selection, if later needed, is a separate decision.

Supported in code today: reporting, published contact, staff review and limited listing/account moderation. Still outstanding: activation and device validation of blocking, objectionable-content filtering across all surfaces, broader content-removal coverage, and evidence of timely report handling. Legal pages alone do not close those gaps.

## Legal consistency

No factual mismatch requiring a legal-text edit was found. The approved Terms use conditional reporting/blocking language and do not claim automated filtering. Privacy describes marketplace activity and safety-related data processing/retention. The effective-date placeholder and governing-law section are unchanged and still require owner/legal input. Soft account deletion retains the profile record and therefore may retain associated block relationships; the existing policy does not promise erasure of every record. Actual profile deletion cascades the relationships.

## Validation

Run the current security and database regression suite described in README.md. Hosted API, device, and staff-workflow validation remain separate checks.

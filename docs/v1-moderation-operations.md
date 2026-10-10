# Moderation architecture and validation

The implementation provides scoped staff inspection, reversible content suppression, and private evidence retention. This document explains the workflow and its technical limits; it does not establish staffing, deployment status, or a guaranteed response time.

## Workflow

1. In Admin → Reports, open **Inspect content** and mark the report under review. Inspection reads only the reported object: listing and its authorized photos; one reported message with sender/time and listing/conversation identifiers; the specific review; or public profile identity/text/avatar. Do not request entire conversations without a separately justified need.
2. Read the report and compare the actual content with the Marketplace Rules. Staff photos use one-minute links; refresh to inspect again. A photo loading error is not evidence that a photo is safe. The screen supports refreshing after expiry.
3. Record a concise reason. Do not paste message bodies, credentials, personal information, or illegal material into notes. Choose **Suppress content** for confirmed violations. The database checks the inspected content revision and refuses stale decisions; refresh and reassess if it changed.
4. Verify the result using a normal test account. Listings and listing-photo metadata are inaccessible to normal readers, including historical access paths. Messages retain an explicit removal placeholder. Reviews disappear from public lists and seller rating aggregates without removing review eligibility/uniqueness records. Profiles show generic identity with public bio/avatar/location cleared. Staff can inspect the saved original text under the same report.
5. Resolve the report with an outcome note only after the intervention succeeded and any image follow-up below is addressed. Dismiss with a reason for non-violations. Report state/reviewer/time/notes and the existing staff action log retain the decision. Inspection, suppression and restoration also record report ID, actor, action, outcome and timestamp.
6. For a mistaken decision, inspect and **Restore content**, with a reason. Original text must still pass migration 046 and existing constraints, including username uniqueness. Restoration failures are atomic and retain suppression/evidence; do not disable safety triggers. Listing lifecycle status is not changed by this report action, so it does not reverse sales or payments. Retained evidence is private and versioned across repeated suppress/restore cycles.

Suspended-user enforcement is **explicitly deferred**. Existing suspension/selling controls retain their current limited meaning and must not be described as a service-wide ban. Pairwise user blocking continues to stop new messages/conversations. Escalate persistent cross-user abuse to the owner; do not assume changing the suspension flag stops all activity.

## Images and urgent escalation

This is human review and takedown, not automated image classification or pre-publication approval. The listing-photo bucket remains private, and new authenticated reads/signing requests must pass both migration 044 authorization and the new moderation policy. Staff inspection signs only paths matching the reported listing and actual object owner. Chat photos use the separate private `chat-images` bucket and staff inspection validates the reported message, sender, and conversation path.

Important technical limits:

- Existing app listing links are signed for one hour. A previously issued signed URL does not re-run the new RLS policy; it can remain valid until expiry. Privileged tooling or clients may have issued longer-lived links. Downloaded images/screenshots and existing device caches cannot be recalled by a database policy.
- The existing profile-avatar bucket is public. Clearing a profile avatar stops new profile displays, and the new policy restricts authenticated storage operations, but **a known public avatar URL may remain accessible**. This task does not make that bucket private or relocate files.
- Original text is retained privately in `ugc_moderation_evidence`. Reported chat-image bytes remain in their original private Storage object, with a separate report-scoped database snapshot of the path and message metadata; no immutable byte copy or content hash is created. Account deletion removes unreported chat objects before conversation cascades and preserves reported objects for staff inspection. Authorized backend storage operations can still change/remove them. Do not treat path retention as an immutable image snapshot.
- The revision check covers the returned text and photo-path metadata, not a cryptographic hash of image bytes. Inspect again if a photo may have changed.
- Older/offline clients can retain previously fetched text and images. Open current-client conversations handle message UPDATE events; reopening/refreshing reloads current suppression states. No remote device wipe is possible.

For urgent image removal, escalate to an authorized owner/storage administrator for a separately reviewed evidence-preserving quarantine/removal and cache-response procedure. Do not mark urgent image cases fully resolved merely because a listing is hidden. Immediate revocation of an already-issued chat image link is not implemented; it may remain valid until its 60-second expiry. Verify old links, avatar public URLs, and cache behavior against the actual service before claiming immediate takedown. A storage follow-up is needed if immediate URL revocation is a launch requirement.

For credible imminent danger, contact appropriate emergency authorities through an approved operational procedure. For suspected illegal imagery, do not download, redistribute or attach it to email/tickets; restrict access and escalate to qualified legal/safety contacts and relevant reporting channels. Seek jurisdiction-appropriate guidance rather than improvising handling or retention rules. Do not include private evidence in general logs or screenshots.

## Release and access checks

- Review migrations 044-048, 052-054 and the current Admin/account-deletion functions before environment validation. Local source does not establish deployment status.

- Moderation changes use forward migrations. Account deletion and reported-image retention must be validated together against the current schema. Suspension and financial workflows have separate authorization boundaries.
- Provision named staff using the existing trusted staff-role process. Ordinary accounts cannot read reports, evidence, or staff logs, and cannot invoke inspection/suppression RPCs. The Edge Function derives the actor from the verified JWT, not request body parameters.
- Before release, demonstrate report → inspect → suppress → normal-user verification → resolve for a listing, message, review and profile; test an unauthorized account, a blocked pair, and image-link limits. Test both normal and mistaken-decision restoration.
- Set an owner-approved retention/review schedule for private moderation evidence and notes; no automated purge or real-data deletion is introduced here. Reported chat-photo bytes and report snapshots remain until a separately approved retention process removes them. Do not add sensitive content to ordinary telemetry.

Release validation depends on deployment/device checks, a separately defined operating procedure, and accepting or addressing the stated storage limitations.

## Database change inventory

Migration 047 creates the private, versioned `ugc_moderation_evidence` table and its unique active-evidence index; adds `reports.review_id` and review target constraints; adds `moderation_hidden_at` to messages, reviews and profiles; and adds three staff-field protection triggers. Four restrictive policies narrow listing, listing-image, review and storage access. Migration 052 adds the private `chat-images` bucket, message attachment metadata, one-use upload reservations, participant/block-aware Storage policies, report-scoped image evidence, and the send/cancel RPCs. The profile public-column grants from 045 are unchanged.

New functions: `submit_review_report_v1`, `ugc_listing_visible_v1`, `ugc_storage_access_v1`, `guard_ugc_moderation_fields_v1`, `ugc_report_content_v1`, `staff_inspect_report_v1`, `staff_suppress_report_content_v1`. Existing `validate_report_submission`, `get_profile_reviews`, `get_public_seller_profile_v2` and `staff_moderate_listing_v1` are replaced in the new migration only. The legacy listing action refuses to bypass an active report takedown. Review list/aggregate functions omit suppressed reviews. The report restoration path refuses to reverse the existing account-deletion anonymization marker; moderation must respect deletion and suspension boundaries.

Applying the migration performs no content backfill, deletion or initial suppression. Later authorized staff actions mask selected content and retain evidence transactionally. Rollback requires a separately reviewed migration: do not drop evidence or restore suppressed material blindly. The UI supports reversal of individual moderation decisions when existing safety and uniqueness checks permit it.

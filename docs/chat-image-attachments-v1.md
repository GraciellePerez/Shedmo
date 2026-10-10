# Chat image attachments V1

Chat photos use the existing `messages` table and conversation notification/read-state triggers. The forward-only migration adds image metadata, upload reservations, participant-scoped Storage policies, and report evidence snapshots. Uploads are normalized on-device to JPEG, limited to 5 MiB, and stored in the private `chat-images` bucket under `conversation/sender/message.jpg`.

The client requests a one-hour, one-use upload reservation, uploads with the authenticated Supabase session, and finalizes through `send_chat_image_v1`. Database triggers validate conversation membership, upload ownership, MIME type, byte size, path, and the existing bilateral block guard. Duplicate retries use the same client-generated message ID. Image reads require a visible, non-deleted message and conversation participation; the client requests 60-second signed URLs and does not cache image bytes.

Message reports retain a private attachment-path snapshot for staff inspection. The staff operation signs only the exact path associated with the reported message. Moderation uses the existing message suppression flag; Storage authorization then denies new signed-URL requests. Existing signed links can remain valid until their short expiry. Account deletion removes unreported chat objects across conversations that will be cascaded; reported objects remain private for staff evidence.

Reported image bytes remain in their original private object; the report evidence snapshot is not an immutable byte copy or content hash. No automated evidence-retention purge is configured. An owner-approved retention/review schedule remains required.

Failed sends retry with the same message ID, and the user can explicitly remove a pending upload. If the app is terminated during an upload, the pending object remains private and inaccessible, but no scheduled orphan-object purge is configured.

## Deployment order

1. After separate authorization, check the DEVELOPMENT migration ledger and apply any unapplied files in timestamp order: `202609130043_add_user_blocking.sql`, `202609140044_harden_listing_image_authorization.sql`, `202609140045_restrict_profile_private_fields.sql`, `202609140046_add_ugc_text_safety.sql`, `202609150047_add_report_moderation_workflow.sql`, `202609150048_protect_account_deletion_from_moderation.sql`, `202609250049_grant_account_deletion_listing_image_read.sql`, `202609250050_grant_account_deletion_listing_image_delete.sql`, `202609270051_grant_account_deletion_remaining_privileges.sql`, then `202609280052_add_private_chat_image_attachments.sql`. Never reapply a migration already recorded in that ledger.
2. Deploy the updated `admin-operations` Edge Function so staff report inspection can sign chat-image evidence.
3. Deploy the updated `delete-account` Edge Function so it removes unreported chat attachments while preserving reported evidence.
4. Create and distribute a new native TestFlight build. The existing picker/manipulator dependencies and picker config plugin are already declared, but the updated iOS photo-library purpose string is native configuration and must reach users in a new build.

No production Supabase project, remote migration, Edge Function deployment, or build was used during local implementation.

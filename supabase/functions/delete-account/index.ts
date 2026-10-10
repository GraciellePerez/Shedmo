import { json, optionsResponse, safeErrorCode } from "../_shared/http.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  createSupabaseAdminClient,
  requireAuthenticatedUser,
} from "../_shared/server.ts";

const failIfError = (error: { message?: string } | null) => {
  if (error) throw error;
};

const listStoredFiles = async (
  admin: SupabaseClient,
  prefix: string,
): Promise<string[]> => {
  const files: string[] = [];
  for (let offset = 0;; offset += 100) {
    const { data, error } = await admin.storage.from("listing-images").list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    failIfError(error);
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      if (item.id) files.push(path);
      else files.push(...await listStoredFiles(admin, path));
    }
    if ((data?.length ?? 0) < 100) break;
  }
  return files;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let stage = "request_validation";
  try {
    const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
    if (body?.confirmation !== "DELETE") return json({ error: "Confirmation required" }, 400);

    const admin = createSupabaseAdminClient();
    const user = await requireAuthenticatedUser(request, admin);
    stage = "eligibility";
    const unresolvedOrder = [
      "fulfillment_status.not.in.(completed,canceled)",
      "payment_status.in.(pending,processing,refund_pending,disputed)",
      "dispute_status.in.(open,awaiting_buyer_evidence,awaiting_seller_response,under_review,external_chargeback)",
      "refund_status.in.(pending,reconciling)",
    ].join(",");
    const participant = `buyer_id.eq.${user.id},seller_id.eq.${user.id}`;
    const [pendingLocal, buyerOrders, sellerOrders] = await Promise.all([
      admin.from("local_sale_confirmations").select("id", { count: "exact", head: true })
        .or(participant).eq("status", "pending_buyer_confirmation"),
      admin.from("orders").select("id", { count: "exact", head: true })
        .eq("buyer_id", user.id).or(unresolvedOrder),
      admin.from("orders").select("id", { count: "exact", head: true })
        .eq("seller_id", user.id).or(unresolvedOrder),
    ]);
    [pendingLocal, buyerOrders, sellerOrders].forEach(({ error }) => failIfError(error));
    if ((pendingLocal.count ?? 0) > 0 || (buyerOrders.count ?? 0) > 0 || (sellerOrders.count ?? 0) > 0) {
      return json({ error: "Resolve active transactions before deleting your account." }, 409);
    }

    // Permanent privacy boundary before any cleanup; retries are idempotent.
    stage = "deletion_marker";
    failIfError((await admin.rpc("record_account_deletion_v1", { p_user_id: user.id })).error);

    stage = "chat_storage_cleanup";
    const { data: conversations, error: conversationError } = await admin.from("conversations")
      .select("id").or(participant);
    failIfError(conversationError);
    const conversationIds = (conversations ?? []).map((conversation) => conversation.id as string);
    if (conversationIds.length) {
      const { data: messages, error: messagesError } = await admin.from("messages")
        .select("id,conversation_id,sender_id,attachment_path")
        .in("conversation_id", conversationIds)
        .not("attachment_path", "is", null);
      failIfError(messagesError);
      const attachments = messages ?? [];
      const messageIds = attachments.map((message) => message.id as string);
      if (messageIds.length) {
        const { data: reported, error: reportError } = await admin.from("reports")
          .select("target_id").eq("report_type", "message").in("target_id", messageIds);
        failIfError(reportError);
        const reportedMessageIds = new Set((reported ?? []).map((report) => report.target_id as string));
        const removablePaths = attachments
          .filter((message) => !reportedMessageIds.has(message.id as string))
          .map((message) => {
            const expected = `${message.conversation_id}/${message.sender_id}/${message.id}.jpg`;
            if (message.attachment_path !== expected) throw new Error("UNSAFE_CHAT_ATTACHMENT_PATH");
            return expected;
          });
        for (let offset = 0; offset < removablePaths.length; offset += 100) {
          const { error } = await admin.storage.from("chat-images").remove(removablePaths.slice(offset, offset + 100));
          failIfError(error);
        }
      }
    }

    const { data: pendingUploads, error: pendingUploadError } = await admin
      .from("chat_image_upload_reservations").select("storage_path").eq("sender_id", user.id);
    failIfError(pendingUploadError);
    const pendingPaths = (pendingUploads ?? []).map((upload) => upload.storage_path as string);
    if (!pendingPaths.every((path) => path.split("/")[1] === user.id
      && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(path))) {
      throw new Error("UNSAFE_CHAT_UPLOAD_PATH");
    }
    for (let offset = 0; offset < pendingPaths.length; offset += 100) {
      const { error } = await admin.storage.from("chat-images").remove(pendingPaths.slice(offset, offset + 100));
      failIfError(error);
    }

    stage = "listing_storage_cleanup";
    const { data: listings, error: listingError } = await admin
      .from("listings").select("id").eq("seller_id", user.id);
    failIfError(listingError);
    const listingIds = (listings ?? []).map((listing) => listing.id as string);
    if (listingIds.length) {
      const { data: images, error: imageError } = await admin
        .from("listing_images").select("storage_path").in("listing_id", listingIds);
      failIfError(imageError);
      const imagePaths = [...new Set([
        ...(images ?? []).map((image) => image.storage_path as string),
        ...await listStoredFiles(admin, user.id),
      ])];
      const storagePrefix = `${user.id}/`;
      if (!imagePaths.every((path) =>
        path.startsWith(storagePrefix) &&
        !path.includes("\\") &&
        !path.split("/").some((part) => part === "." || part === "..")
      )) {
        throw new Error("UNSAFE_STORAGE_PATH");
      }
      for (let offset = 0; offset < imagePaths.length; offset += 100) {
        const { error } = await admin.storage
          .from("listing-images").remove(imagePaths.slice(offset, offset + 100));
        failIfError(error);
      }
    }
    stage = "avatar_storage_cleanup";
    failIfError((await admin.storage.from("profile-avatars").remove([
      `${user.id}/avatar.jpg`,
    ])).error);

    // Migration 054 finalizes all database cleanup in the Auth soft-delete
    // transaction. A failure rolls back anonymization and Auth together.
    stage = "auth_and_database_deletion";
    failIfError((await admin.auth.admin.deleteUser(user.id, true)).error);
    return json({ deleted: true });
  } catch (error) {
    console.error("Account deletion failed", { stage, errorCode: safeErrorCode(error) });
    return json({ error: "Account deletion failed" }, 500);
  }
});

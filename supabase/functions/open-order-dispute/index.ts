import {
  authenticatedHandler,
  parseObject,
  requireText,
  requireUuid,
} from "../_shared/fulfillment.ts";

authenticatedHandler("open_order_dispute", async (request, admin, user) => {
  const body = await parseObject(request, [
    "orderId",
    "type",
    "explanation",
    "evidencePaths",
  ]);
  const type = requireText(body.type, 5, 80);
  const evidence =
    Array.isArray(body.evidencePaths) && body.evidencePaths.every((value) =>
        typeof value === "string" && value.length >= 3 && value.length <= 500
      )
      ? body.evidencePaths
      : [];
  if (evidence.length > 8) {
    throw new Error("INVALID_REQUEST");
  }
  const { data, error } = await admin.rpc("open_order_dispute_v1", {
    p_order_id: requireUuid(body.orderId),
    p_buyer_id: user.id,
    p_type: type,
    p_explanation: requireText(body.explanation, 20, 4000),
    p_evidence_paths: evidence,
  }).single();
  if (error || !data) {
    throw error ?? new Error("DISPUTE_CREATE_FAILED");
  }
  return {
    orderId: String((data as { order_id: unknown }).order_id),
    status: "opened",
  };
});

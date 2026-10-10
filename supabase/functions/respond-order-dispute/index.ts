import {
  authenticatedHandler,
  parseObject,
  requireText,
  requireUuid,
} from "../_shared/fulfillment.ts";

authenticatedHandler("respond_order_dispute", async (request, admin, user) => {
  const body = await parseObject(request, ["disputeId", "response"]);
  const { data, error } = await admin.rpc("respond_order_dispute_v1", {
    p_dispute_id: requireUuid(body.disputeId),
    p_seller_id: user.id,
    p_response: requireText(body.response, 20, 4000),
  }).single();
  if (error || !data) throw error ?? new Error("DISPUTE_RESPONSE_FAILED");
  return {
    orderId: String((data as { order_id: unknown }).order_id),
    status: "under_review",
  };
});

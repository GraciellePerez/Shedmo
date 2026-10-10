import {
  authenticatedHandler,
  invokeOrderRpc,
  parseObject,
  requireText,
  requireUuid,
} from "../_shared/fulfillment.ts";

authenticatedHandler("complete_pickup", async (request, admin, user) => {
  const body = await parseObject(request, [
    "expectedOrderId",
    "scannedOrderId",
    "buyerId",
    "token",
  ]);
  return await invokeOrderRpc(admin, "consume_pickup_token_bound_v2", {
    p_expected_order_id: requireUuid(body.expectedOrderId),
    p_scanned_order_id: requireUuid(body.scannedOrderId),
    p_seller_id: user.id,
    p_buyer_id: requireUuid(body.buyerId),
    p_token: requireText(body.token, 64, 64),
  });
});

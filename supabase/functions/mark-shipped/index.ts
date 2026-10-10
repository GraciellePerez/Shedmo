import {
  authenticatedHandler,
  invokeOrderRpc,
  parseObject,
  requireText,
  requireUuid,
} from "../_shared/fulfillment.ts";
import { requirePublicShipping } from "../_shared/launchFeatures.ts";

authenticatedHandler("mark_shipped", async (request, admin, user) => {
  requirePublicShipping();
  const body = await parseObject(request, [
    "orderId",
    "carrier",
    "trackingNumber",
    "shippedAt",
  ]);
  const shippedAt = requireText(body.shippedAt, 20, 40);
  if (!Number.isFinite(Date.parse(shippedAt))) {
    throw new Error("INVALID_REQUEST");
  }
  return await invokeOrderRpc(admin, "mark_order_shipped", {
    p_order_id: requireUuid(body.orderId),
    p_seller_id: user.id,
    p_carrier: requireText(body.carrier, 2, 80),
    p_tracking_number: requireText(body.trackingNumber, 3, 120),
    p_shipped_at: shippedAt,
  });
});

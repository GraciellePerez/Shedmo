import {
  authenticatedHandler,
  parseObject,
  requireText,
  requireUuid,
} from "../_shared/fulfillment.ts";

authenticatedHandler("complete_pickup_by_pin", async (request, admin, user) => {
  const body = await parseObject(request, ["orderId", "pin"]);
  const orderId = requireUuid(body.orderId);
  const pin = requireText(body.pin, 6, 6);
  if (!/^\d{6}$/.test(pin)) throw new Error("INVALID_REQUEST");
  const { data, error } = await admin.rpc("consume_pickup_pin_v1", {
    p_order_id: orderId,
    p_seller_id: user.id,
    p_pin: pin,
  }).single();
  if (error) throw error;
  const result = (data as { result?: unknown } | null)?.result;
  if (result !== "completed") {
    return {
      orderId,
      status: "rejected",
      reason: result === "locked" ? "locked" : "invalid",
    };
  }
  return { orderId, status: "completed" };
});

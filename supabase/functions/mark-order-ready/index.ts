import {
  authenticatedHandler,
  invokeOrderRpc,
  parseObject,
  requireUuid,
} from "../_shared/fulfillment.ts";

authenticatedHandler("mark_order_ready", async (request, admin, user) => {
  const body = await parseObject(request, ["orderId"]);
  return await invokeOrderRpc(admin, "mark_order_ready_for_pickup", {
    p_order_id: requireUuid(body.orderId),
    p_seller_id: user.id,
  });
});

import {
  authenticatedHandler,
  invokeOrderRpc,
  parseObject,
  requireUuid,
} from "../_shared/fulfillment.ts";
import { requirePublicShipping } from "../_shared/launchFeatures.ts";

authenticatedHandler("accept_delivery", async (request, admin, user) => {
  requirePublicShipping();
  const body = await parseObject(request, ["orderId"]);
  return await invokeOrderRpc(admin, "accept_order_delivery_v1", {
    p_order_id: requireUuid(body.orderId),
    p_buyer_id: user.id,
  });
});

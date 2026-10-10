import {
  authenticatedHandler,
  invokeOrderRpc,
  parseObject,
  requireUuid,
} from "../_shared/fulfillment.ts";
import { requirePublicShipping } from "../_shared/launchFeatures.ts";

authenticatedHandler("mark_delivered", async (request, admin, user) => {
  requirePublicShipping();
  const body = await parseObject(request, ["orderId"]);
  return await invokeOrderRpc(admin, "mark_order_delivered", {
    p_order_id: requireUuid(body.orderId),
    p_buyer_id: user.id,
  });
});

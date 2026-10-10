import type { SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";

import { createEasyPostTracker } from "../_shared/easypost.ts";
import {
  authenticatedHandler,
  invokeOrderRpc,
  parseObject,
  requireText,
  requireUuid,
} from "../_shared/fulfillment.ts";
import { safeErrorCode } from "../_shared/http.ts";
import { requirePublicShipping } from "../_shared/launchFeatures.ts";
import {
  applyEasyPostTrackerEvidence,
  applyRegistrationFailure,
  applyTrustedShipmentEvent,
  findShipmentByProviderTracker,
} from "../_shared/trustedShipment.ts";

const trackingFailure = (error: unknown): never => {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "") : "";
  const databaseCode = safeErrorCode(error);
  const code = databaseCode === "23505" ? "TRACKING_ALREADY_USED"
    : message.includes("carrier") || message.includes("tracking number") || message.includes("Tracking format") ? "TRACKING_INVALID"
    : message.includes("Carrier-accepted") || message.includes("correction limit") ? "TRACKING_CHANGE_BLOCKED"
    : message.includes("Tracking submission is unavailable") ? "TRACKING_ORDER_INELIGIBLE"
    : null;
  if (code) throw Object.assign(new Error(code), { code });
  throw error;
};

const registerOutboundTracker = async (
  admin: SupabaseClient,
  orderId: string,
) => {
  const { data: shipment, error } = await admin
    .from("order_shipments")
    .select("order_id,carrier,tracking_number,tracking_version")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error || !shipment?.carrier || !shipment.tracking_number) return;

  const apiKey = Deno.env.get("EASYPOST_API_KEY")?.trim();
  const trackingVersion = Number(shipment.tracking_version ?? 1);
  if (!apiKey) {
    await applyRegistrationFailure(admin, {
      orderId,
      trackingVersion,
      kind: "config",
      code: "provider_config",
    });
    return;
  }

  const created = await createEasyPostTracker(
    apiKey,
    String(shipment.tracking_number),
    String(shipment.carrier),
  );
  if (!created.ok) {
    await applyRegistrationFailure(admin, {
      orderId,
      trackingVersion,
      kind: created.kind,
      code: created.code ?? created.kind,
    });
    return;
  }

  const existing = await findShipmentByProviderTracker(admin, created.tracker.id);
  if (existing?.order_id && String(existing.order_id) !== orderId) {
    await applyRegistrationFailure(admin, {
      orderId,
      trackingVersion,
      kind: "config",
      code: "tracker_in_use",
    });
    return;
  }

  const outcome = await applyEasyPostTrackerEvidence(admin, {
    orderId,
    eventId: `easypost:tracker:${created.tracker.id}:registered`,
    tracker: created.tracker,
  });
  if (outcome === "applied" || outcome === "duplicate" || outcome === "ignored_stale") {
    return;
  }
  await applyTrustedShipmentEvent(admin, {
    orderId,
    eventId: `easypost:register:${orderId}:v${trackingVersion}:bind_failed`,
    trackerId: "",
    shipmentState: "verification_delayed",
    occurredAt: new Date().toISOString(),
    providerStatus: "registration_bind_failed",
    providerStatusCode: outcome,
    testMode: created.tracker.mode === "test",
  });
};

authenticatedHandler("submit_shipment_tracking", async (request, admin, user) => {
  requirePublicShipping();
  const body = await parseObject(request, ["orderId", "carrier", "trackingNumber"]);
  let submitted: { orderId: string };
  try {
    submitted = await invokeOrderRpc(admin, "submit_order_shipment_tracking_v1", {
      p_order_id: requireUuid(body.orderId),
      p_seller_id: user.id,
      p_carrier: requireText(body.carrier, 2, 80),
      p_tracking_number: requireText(body.trackingNumber, 3, 120),
    });
  } catch (error) {
    return trackingFailure(error);
  }
  try {
    await registerOutboundTracker(admin, submitted.orderId);
  } catch (error) {
    console.error("EasyPost tracker registration failed", {
      operation: "submit_shipment_tracking",
      errorCode: safeErrorCode(error),
    });
  }
  return submitted;
});

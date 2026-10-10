import { createClient } from "npm:@supabase/supabase-js@2.111.0";

import {
  parseEasyPostTrackerEvent,
  verifyEasyPostWebhookSignatureV2,
} from "../_shared/easypost.ts";
import { json, safeErrorCode } from "../_shared/http.ts";
import {
  applyEasyPostTrackerEvidence,
  findShipmentByProviderTracker,
} from "../_shared/trustedShipment.ts";
import { publicShippingEnabled } from "../_shared/launchFeatures.ts";

const requiredEnvironment = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, false);
  }
  if (!publicShippingEnabled()) {
    return json({ error: "Not found." }, 404, false);
  }

  let webhookSecret: string;
  let admin;
  try {
    webhookSecret = requiredEnvironment("EASYPOST_WEBHOOK_SECRET");
    admin = createClient(
      requiredEnvironment("SUPABASE_URL"),
      requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  } catch {
    console.error("EasyPost webhook server configuration missing", {
      operation: "easypost_webhook",
    });
    return json({ error: "Server configuration unavailable." }, 500, false);
  }

  const rawBody = await request.text();
  // Supabase exposes the provider-facing route as /functions/v1/easypost-webhook.
  // Match EasyPost's signed path to the actual URL pathname before using it in the HMAC.
  const requestPath = new URL(request.url).pathname;
  const valid = await verifyEasyPostWebhookSignatureV2({
    rawBody,
    signatureHeader: request.headers.get("X-Hmac-Signature-v2"),
    timestampHeader: request.headers.get("X-Timestamp"),
    pathHeader: request.headers.get("X-Path"),
    requestMethod: request.method,
    requestPath,
    webhookSecret,
  });
  if (!valid) {
    console.warn("EasyPost webhook signature rejected", {
      operation: "easypost_webhook",
    });
    return json({ error: "Unauthorized." }, 401, false);
  }

  let parsed;
  try {
    parsed = parseEasyPostTrackerEvent(JSON.parse(rawBody) as unknown);
  } catch {
    return json({ error: "Invalid event." }, 400, false);
  }

  if (parsed.ignored) {
    return json({ received: true, ignored: true }, 200, false);
  }

  const tracker = parsed.tracker;
  const eventId = parsed.eventId;
  if (!tracker || !eventId) {
    return json({ error: "Invalid event." }, 400, false);
  }

  try {
    const shipment = await findShipmentByProviderTracker(admin, tracker.id);
    if (!shipment?.order_id) {
      return json({ error: "Unknown tracker." }, 404, false);
    }

    const outcome = await applyEasyPostTrackerEvidence(admin, {
      orderId: String(shipment.order_id),
      eventId,
      tracker,
      fallbackOccurredAt: parsed.createdAt,
    });

    if (outcome === "applied" || outcome === "duplicate" || outcome === "ignored_stale") {
      return json({ received: true, outcome }, 200, false);
    }
    if (outcome === "binding_mismatch") {
      console.error("EasyPost webhook tracker binding rejected", {
        operation: "easypost_webhook",
      });
      return json({ error: "Tracker binding rejected." }, 409, false);
    }
    console.error("EasyPost webhook event processing failed", {
      operation: "easypost_webhook",
    });
    return json({ error: "Event could not be applied." }, 500, false);
  } catch (error) {
    console.error("EasyPost webhook event processing failed", {
      operation: "easypost_webhook",
      errorCode: safeErrorCode(error),
    });
    return json({ error: "Event could not be applied." }, 500, false);
  }
});

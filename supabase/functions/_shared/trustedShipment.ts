import type { SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";

import {
  EASYPOST_PROVIDER,
  type EasyPostFailureKind,
  type EasyPostTracker,
  type ShedmoShipmentState,
  delayedStateForFailure,
  mapEasyPostTrackerStatus,
  trackerOccurredAt,
} from "./easypost.ts";
import { safeErrorCode } from "./http.ts";

export type TrustedEventOutcome =
  | "applied"
  | "duplicate"
  | "ignored_stale"
  | "binding_mismatch"
  | "failed";

const rpcMessage = (error: unknown): string => {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String((error as { message?: unknown }).message ?? "");
};

export const classifyTrustedShipmentError = (error: unknown): TrustedEventOutcome => {
  const message = rpcMessage(error);
  const code = safeErrorCode(error);
  if (
    message.includes("Provider event binding mismatch") ||
    message.includes("Provider binding mismatch") ||
    message.includes("Provider tracker binding mismatch")
  ) {
    return "binding_mismatch";
  }
  if (
    message.includes("Stale provider event") ||
    message.includes("Shipment state cannot regress") ||
    message.includes("Delivered shipment cannot regress")
  ) {
    return "ignored_stale";
  }
  if (code === "23505" && message.includes("provider_event")) return "duplicate";
  if (code === "23505" && message.includes("provider_tracker")) return "binding_mismatch";
  return "failed";
};

export const findShipmentByProviderTracker = async (
  admin: SupabaseClient,
  trackerId: string,
) => {
  const { data, error } = await admin
    .from("order_shipments")
    .select(
      "order_id,carrier,tracking_number,shipment_state,provider_name,provider_tracker_id,carrier_accepted_at,delivered_at",
    )
    .eq("provider_name", EASYPOST_PROVIDER)
    .eq("provider_tracker_id", trackerId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const applyTrustedShipmentEvent = async (
  admin: SupabaseClient,
  input: {
    orderId: string;
    eventId: string;
    trackerId: string;
    shipmentState: ShedmoShipmentState;
    occurredAt: string;
    providerStatus?: string | null;
    providerStatusCode?: string | null;
    testMode: boolean;
  },
): Promise<TrustedEventOutcome> => {
  const { error } = await admin.rpc("apply_trusted_shipment_event_v1", {
    p_order_id: input.orderId,
    p_provider_name: EASYPOST_PROVIDER,
    p_provider_event_id: input.eventId,
    p_provider_tracker_id: input.trackerId,
    p_shipment_state: input.shipmentState,
    p_occurred_at: input.occurredAt,
    p_provider_status: input.providerStatus ?? null,
    p_provider_status_code: input.providerStatusCode ?? null,
    p_test_mode: input.testMode,
  }).single();
  if (!error) return "applied";
  return classifyTrustedShipmentError(error);
};

export const applyEasyPostTrackerEvidence = (
  admin: SupabaseClient,
  input: {
    orderId: string;
    eventId: string;
    tracker: EasyPostTracker;
    fallbackOccurredAt?: string | null;
  },
): Promise<TrustedEventOutcome> =>
  applyTrustedShipmentEvent(admin, {
    orderId: input.orderId,
    eventId: input.eventId,
    trackerId: input.tracker.id,
    shipmentState: mapEasyPostTrackerStatus(input.tracker.status),
    occurredAt: trackerOccurredAt(input.tracker, input.fallbackOccurredAt),
    providerStatus: input.tracker.status ?? null,
    providerStatusCode: input.tracker.status_detail ?? null,
    testMode: input.tracker.mode === "test",
  });

export const applyRegistrationFailure = (
  admin: SupabaseClient,
  input: {
    orderId: string;
    trackingVersion: number;
    kind: EasyPostFailureKind;
    trackerId?: string | null;
    code?: string | null;
  },
): Promise<TrustedEventOutcome> =>
  applyTrustedShipmentEvent(admin, {
    orderId: input.orderId,
    eventId: `easypost:register:${input.orderId}:v${input.trackingVersion}:${input.kind}`,
    trackerId: input.trackerId ?? "",
    shipmentState: delayedStateForFailure(input.kind),
    occurredAt: new Date().toISOString(),
    providerStatus: "registration_failed",
    providerStatusCode: input.code ?? input.kind,
    testMode: false,
  });

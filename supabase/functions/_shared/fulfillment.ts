import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2.111.0";

import { json, optionsResponse, safeErrorCode } from "./http.ts";
import {
  createSupabaseAdminClient,
  requireAuthenticatedUser,
} from "./server.ts";

export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const parseObject = async (request: Request, allowed: string[]) => {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_REQUEST");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !allowed.includes(key))) {
    throw new Error("INVALID_REQUEST");
  }
  return row;
};

export const requireUuid = (value: unknown) => {
  if (typeof value !== "string" || !uuid.test(value)) {
    throw new Error("INVALID_REQUEST");
  }
  return value;
};

export const requireText = (value: unknown, min: number, max: number) => {
  if (typeof value !== "string") throw new Error("INVALID_REQUEST");
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new Error("INVALID_REQUEST");
  }
  return trimmed;
};

export const fulfillmentError = (error: unknown) => {
  const code = safeErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") {
    return ["Authentication required.", 401] as const;
  }
  if (message === "FEATURE_DISABLED") {
    return ["This feature is unavailable.", 404] as const;
  }
  if (message === "QR_ORDER_MISMATCH") {
    return ["This QR belongs to a different order.", 409] as const;
  }
  if (message === "TRACKING_INVALID") {
    return ["Enter a tracking number that matches the selected carrier.", 400] as const;
  }
  if (message === "TRACKING_ALREADY_USED") {
    return ["This tracking number is already in use on an active shipment.", 409] as const;
  }
  if (message === "TRACKING_ORDER_INELIGIBLE") {
    return ["Tracking cannot be submitted for this order right now.", 409] as const;
  }
  if (message === "TRACKING_CHANGE_BLOCKED") {
    return ["Tracking cannot be changed after carrier acceptance.", 409] as const;
  }
  if (message === "INVALID_REQUEST" || code === "22023") {
    return ["Invalid request.", 400] as const;
  }
  if (code === "42501") return ["Order access denied.", 403] as const;
  if (code === "P0002") return ["Order not found.", 404] as const;
  if (code === "55000") {
    return [
      "This action is not available for the order's current state.",
      409,
    ] as const;
  }
  return ["Order could not be updated.", 502] as const;
};

export const authenticatedHandler = (
  operation: string,
  action: (
    request: Request,
    admin: SupabaseClient,
    user: User,
  ) => Promise<unknown>,
) =>
  Deno.serve(async (request: Request) => {
    if (request.method === "OPTIONS") return optionsResponse();
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    try {
      const admin = createSupabaseAdminClient();
      const user = await requireAuthenticatedUser(request, admin);
      return json(await action(request, admin, user));
    } catch (error) {
      const [message, status] = fulfillmentError(error);
      const diagnosticCode = safeErrorCode(error);
      console.error("Fulfillment operation failed", {
        operation,
        errorCode: safeErrorCode(error),
      });
      return json({
        error: message,
        code: /^[A-Z0-9_]{1,20}$/.test(diagnosticCode)
          ? diagnosticCode
          : "FULFILLMENT_UNAVAILABLE",
      }, status);
    }
  });

export const invokeOrderRpc = async (
  admin: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
) => {
  const { data, error } = await admin.rpc(name, parameters).single();
  if (error) throw error;
  if (!data || typeof data !== "object" || !("id" in data)) {
    throw new Error("ORDER_UPDATE_FAILED");
  }
  return { orderId: String((data as { id: unknown }).id) };
};

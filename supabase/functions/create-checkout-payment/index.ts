import type { SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import type Stripe from "npm:stripe@22.4.0";

import { json, optionsResponse, safeErrorCode } from "../_shared/http.ts";
import {
  createStripeClient,
  createSupabaseAdminClient,
  createSupabaseUserClient,
  requireAuthenticatedUser,
} from "../_shared/server.ts";
import { protectedCheckoutEnabled } from "../_shared/launchFeatures.ts";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_ATTEMPT_VERSION = "v1";

interface CheckoutBody {
  listingId: string;
  fulfillmentType: "pickup" | "shipping";
  clientCheckoutKey: string;
  destination?: {
    recipientName: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    region: string;
    postalCode: string;
    countryCode: "US";
  };
}

const destinationText = (value: unknown, min: number, max: number) =>
  typeof value === "string" && value.trim().length >= min &&
    value.trim().length <= max;

const isDestination = (value: unknown): value is NonNullable<CheckoutBody["destination"]> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return !Object.keys(row).some((key) => ![
    "recipientName", "addressLine1", "addressLine2", "city", "region",
    "postalCode", "countryCode",
  ].includes(key)) && destinationText(row.recipientName, 2, 120) &&
    destinationText(row.addressLine1, 3, 120) &&
    (row.addressLine2 === "" || destinationText(row.addressLine2, 1, 120)) &&
    destinationText(row.city, 2, 80) &&
    typeof row.region === "string" && /^[A-Za-z]{2}$/.test(row.region.trim()) &&
    typeof row.postalCode === "string" && /^\d{5}(-\d{4})?$/.test(row.postalCode.trim()) &&
    row.countryCode === "US";
};

const parseBody = async (request: Request): Promise<CheckoutBody> => {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object") throw new Error("INVALID_REQUEST");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((key) =>
      !["listingId", "fulfillmentType", "clientCheckoutKey", "destination"].includes(key)
    ) ||
    typeof row.listingId !== "string" || !uuid.test(row.listingId) ||
    typeof row.clientCheckoutKey !== "string" ||
    !uuid.test(row.clientCheckoutKey) ||
    (row.fulfillmentType !== "pickup" && row.fulfillmentType !== "shipping") ||
    (row.fulfillmentType === "shipping" && !isDestination(row.destination)) ||
    (row.fulfillmentType === "pickup" && row.destination !== undefined)
  ) throw new Error("INVALID_REQUEST");
  return row as unknown as CheckoutBody;
};

const publicError = (error: unknown) => {
  const code = safeErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") {
    return ["Authentication required.", 401] as const;
  }
  if (message === "INVALID_REQUEST" || code === "22023") {
    return ["Invalid checkout request.", 400] as const;
  }
  if (code === "P0002") {
    return ["This listing is no longer available.", 404] as const;
  }
  if (code === "55000") {
    return ["This listing is no longer available.", 409] as const;
  }
  if (message === "CHECKOUT_EXPIRED") {
    return ["Checkout expired. Please try again.", 409] as const;
  }
  return ["Checkout could not be started.", 502] as const;
};

const ensurePaymentIntent = async (
  stripe: Stripe,
  admin: SupabaseClient,
  order: Record<string, unknown>,
) => {
  const { data: stored, error: lookupError } = await admin.from("payments")
    .select("stripe_payment_intent_id,status,amount,currency")
    .eq("order_id", order.id).maybeSingle();
  if (lookupError) throw new Error("PAYMENT_STATE_UNAVAILABLE");

  let intent: Stripe.PaymentIntent;
  if (stored?.stripe_payment_intent_id) {
    try {
      intent = await stripe.paymentIntents.retrieve(
        stored.stripe_payment_intent_id,
      );
    } catch {
      throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
    }
  } else {
    try {
      intent = await stripe.paymentIntents.create({
        amount: Number(order.total_amount),
        currency: "usd",
        payment_method_types: ["card"],
        metadata: {
          order_id: String(order.id),
          listing_id: String(order.listing_id),
          buyer_id: String(order.buyer_id),
          seller_id: String(order.seller_id),
        },
      }, {
        idempotencyKey: `checkout-payment:${order.id}:${PAYMENT_ATTEMPT_VERSION}`,
      });
    } catch {
      throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
    }
  }

  if (
    intent.amount !== Number(order.total_amount) || intent.currency !== "usd" ||
    intent.metadata.order_id !== order.id ||
    intent.metadata.listing_id !== order.listing_id ||
    intent.metadata.buyer_id !== order.buyer_id ||
    intent.metadata.seller_id !== order.seller_id ||
    ["succeeded", "canceled"].includes(intent.status) || !intent.client_secret
  ) throw new Error("PAYMENT_INTENT_INCONSISTENT");

  const paymentStatus = intent.status === "processing"
    ? "processing"
    : "pending";
  const { error: storeError } = await admin.from("payments").upsert({
    order_id: order.id,
    stripe_payment_intent_id: intent.id,
    status: paymentStatus,
    amount: order.total_amount,
    currency: "usd",
  }, { onConflict: "order_id" });
  if (storeError) throw new Error("PAYMENT_STATE_UNAVAILABLE");
  const { error: orderError } = await admin.from("orders").update({
    payment_status: paymentStatus,
    fulfillment_status: "awaiting_payment",
  }).eq("id", order.id).neq("payment_status", "succeeded");
  if (orderError) throw new Error("PAYMENT_STATE_UNAVAILABLE");
  return intent.client_secret;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!protectedCheckoutEnabled()) {
    return json({ error: "Checkout unavailable.", code: "FEATURE_DISABLED" }, 404);
  }
  try {
    const body = await parseBody(request);
    const admin = createSupabaseAdminClient();
    const user = await requireAuthenticatedUser(request, admin);
    const userClient = createSupabaseUserClient(request);
    const stripe = createStripeClient();

    const { data: reservation, error: reservationError } = await userClient.rpc(
      "reserve_listing_for_checkout_v2",
      {
        p_listing_id: body.listingId,
        p_fulfillment_type: body.fulfillmentType,
        p_client_checkout_key: body.clientCheckoutKey,
        p_recipient_name: body.destination?.recipientName ?? null,
        p_address_line1: body.destination?.addressLine1 ?? null,
        p_address_line2: body.destination?.addressLine2 || null,
        p_city: body.destination?.city ?? null,
        p_region: body.destination?.region ?? null,
        p_postal_code: body.destination?.postalCode ?? null,
        p_country_code: body.destination?.countryCode ?? null,
      },
    ).single();
    if (reservationError) {
      const rawReservationCode = safeErrorCode(reservationError);
      const ambiguousColumn = rawReservationCode === "42702" &&
          typeof reservationError.message === "string"
        ? reservationError.message.match(
          /column reference "([a-z_]{1,30})" is ambiguous/,
        )?.[1]
        : undefined;
      const reservationCode = `${rawReservationCode}${
        ambiguousColumn ? `_${ambiguousColumn}` : ""
      }`
        .replace(/[^a-zA-Z0-9]/g, "_").toUpperCase().slice(0, 30);
      throw new Error(`RESERVATION_DB_${reservationCode || "UNKNOWN"}`);
    }
    if (
      !reservation || typeof reservation !== "object" ||
      !("order_id" in reservation) || typeof reservation.order_id !== "string"
    ) {
      throw new Error("RESERVATION_INVALID");
    }

    const { data: order, error: orderError } = await admin.from("orders")
      .select(
        "id,buyer_id,seller_id,listing_id,fulfillment_type,payment_status,fulfillment_status,item_amount,shipping_amount,tax_amount,total_amount,currency,listing_title_snapshot,listing_image_snapshot,reservation_expires_at,shipping_workflow_version",
      ).eq("id", reservation.order_id).single();
    if (orderError) throw new Error("ORDER_STATE_UNAVAILABLE");
    if (
      order.buyer_id !== user.id || order.listing_id !== body.listingId ||
      order.fulfillment_type !== body.fulfillmentType ||
      order.currency !== "usd" ||
      Number(order.tax_amount) !== 0 || order.payment_status === "succeeded"
    ) throw new Error("ORDER_INCONSISTENT");
    if (body.fulfillmentType === "shipping" && order.shipping_workflow_version !== 3) {
      throw new Error("ORDER_INCONSISTENT");
    }
    if (
      !order.reservation_expires_at ||
      new Date(order.reservation_expires_at).getTime() <= Date.now()
    ) {
      throw new Error("CHECKOUT_EXPIRED");
    }

    const [
      { data: listing, error: listingError },
      { data: seller, error: sellerError },
      { data: sellerProfile, error: sellerProfileError },
    ] = await Promise.all([
      admin.from("listings").select("id,seller_id,status").eq(
        "id",
        order.listing_id,
      ).single(),
      admin.from("seller_payment_accounts").select(
        "user_id,onboarding_status,details_submitted,payouts_enabled,transfer_capability_status,risk_tier",
      ).eq("user_id", order.seller_id).single(),
      admin.from("profiles").select("staff_sell_restricted,account_suspended_at")
        .eq("id", order.seller_id).single(),
    ]);
    if (listingError) throw new Error("LISTING_STATE_UNAVAILABLE");
    if (sellerError) throw new Error("SELLER_PAYMENT_STATE_UNAVAILABLE");
    if (sellerProfileError) throw new Error("SELLER_PROFILE_STATE_UNAVAILABLE");
    if (
      listing.status !== "reserved" || listing.seller_id !== order.seller_id
    ) {
      throw new Error("LISTING_INCONSISTENT");
    }
    if (
      seller.onboarding_status !== "enabled" || !seller.details_submitted ||
      !seller.payouts_enabled ||
      seller.transfer_capability_status !== "active" ||
      seller.risk_tier === "restricted" || sellerProfile.staff_sell_restricted ||
      sellerProfile.account_suspended_at !== null
    ) throw new Error("SELLER_INELIGIBLE");

    const clientSecret = await ensurePaymentIntent(stripe, admin, order);
    return json({
      orderId: order.id,
      paymentIntentClientSecret: clientSecret,
      summary: {
        title: order.listing_title_snapshot,
        image: order.listing_image_snapshot,
        itemAmount: Number(order.item_amount),
        shippingAmount: Number(order.shipping_amount),
        taxAmount: Number(order.tax_amount),
        totalAmount: Number(order.total_amount),
        currency: order.currency,
        fulfillmentType: order.fulfillment_type,
      },
      reservationExpiresAt: order.reservation_expires_at,
    });
  } catch (error) {
    const [message, status] = publicError(error);
    const diagnosticCode = error instanceof Error && (
      /^RESERVATION_DB_[A-Z0-9_]{1,30}$/.test(error.message) || [
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "PAYMENT_STATE_UNAVAILABLE",
      "PAYMENT_INTENT_INCONSISTENT",
      "RESERVATION_INVALID",
      "RESERVATION_UNAVAILABLE",
      "ORDER_STATE_UNAVAILABLE",
      "ELIGIBILITY_STATE_UNAVAILABLE",
      "LISTING_STATE_UNAVAILABLE",
      "SELLER_PAYMENT_STATE_UNAVAILABLE",
      "SELLER_PROFILE_STATE_UNAVAILABLE",
      "ORDER_INCONSISTENT",
      "LISTING_INCONSISTENT",
      "SELLER_INELIGIBLE",
    ].includes(error.message)
    ) ? error.message : "CHECKOUT_UNAVAILABLE";
    console.error("Checkout payment initialization failed", {
      operation: "create_checkout_payment",
      errorCode: safeErrorCode(error),
    });
    return json({ error: message, code: diagnosticCode }, status);
  }
});

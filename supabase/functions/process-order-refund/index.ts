import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import Stripe from "npm:stripe@22.4.0";

import { json, safeErrorCode } from "../_shared/http.ts";
import {
  recoverRefund,
  recoverReversal,
  refundMatchesClaim,
  reversalMatchesClaim,
} from "../_shared/refundReconciliation.ts";

const required = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, false);
  }
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  if (request.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return json({ error: "Authentication required." }, 401, false);
  }
  const body = await request.json().catch(() => null) as
    | { refundId?: unknown }
    | null;
  if (
    !body || typeof body.refundId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.refundId)
  ) {
    return json({ error: "Invalid request." }, 400, false);
  }
  const admin = createClient(required("SUPABASE_URL"), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
  const { data: row, error } = await admin.from("order_refunds")
    .select(
      "id,order_id,status,stripe_refund_id,refund_reference,stripe_payment_intent_id,amount,currency",
    )
    .eq("id", body.refundId).single();
  if (error || !row) return json({ error: "Refund not found." }, 404, false);
  const claim = {
    refundId: row.id,
    status: row.status,
    stripeRefundId: row.stripe_refund_id,
    refundReference: row.refund_reference,
    paymentIntentId: row.stripe_payment_intent_id,
    amount: Number(row.amount),
    currency: row.currency as "usd",
  };
  if (claim.status === "succeeded") {
    return json({ status: "succeeded" }, 200, false);
  }

  const { data: release } = await admin.from("seller_payout_releases")
    .select("status").eq("order_id", row.order_id).maybeSingle();
  if (release?.status === "transferred") {
    const { data: reversalRow, error: reversalError } = await admin.rpc(
      "prepare_transfer_reversal_v1",
      { p_refund_id: claim.refundId },
    ).single();
    if (reversalError || !reversalRow) {
      return json({ error: "Reversal could not be prepared." }, 409, false);
    }
    const trustedReversal = reversalRow as {
      reversal_id: string;
      reversal_status: string;
      stripe_reversal_id: string | null;
      reversal_reference: string;
      transfer_id: string;
      amount: number;
      currency: "usd";
    };
    const reversalClaim = {
      reversalId: trustedReversal.reversal_id,
      status: trustedReversal.reversal_status,
      stripeReversalId: trustedReversal.stripe_reversal_id,
      reversalReference: trustedReversal.reversal_reference,
      transferId: trustedReversal.transfer_id,
      amount: Number(trustedReversal.amount),
      currency: trustedReversal.currency,
    };
    try {
      let reversal = await recoverReversal(stripe, reversalClaim);
      if (!reversal) {
        reversal = await stripe.transfers.createReversal(
          reversalClaim.transferId,
          {
            amount: reversalClaim.amount,
            metadata: {
              reversal_id: reversalClaim.reversalId,
              reversal_reference: reversalClaim.reversalReference,
            },
          },
          {
            idempotencyKey: `transfer-reversal:${reversalClaim.reversalId}:v1`,
          },
        );
      }
      if (!reversalMatchesClaim(reversal, reversalClaim)) {
        throw new Error("REVERSAL_MISMATCH");
      }
      const { error: finalizeError } = await admin.rpc(
        "finalize_transfer_reversal_v1",
        {
          p_reversal_id: reversalClaim.reversalId,
          p_stripe_reversal_id: reversal.id,
        },
      );
      if (finalizeError) throw finalizeError;
    } catch (caught) {
      await admin.rpc("mark_transfer_reversal_reconciling_v1", {
        p_reversal_id: reversalClaim.reversalId,
        p_failure_code: safeErrorCode(caught),
      });
      return json({ status: "reconciling" }, 202, false);
    }
  }

  try {
    let refund = await recoverRefund(stripe, claim);
    if (!refund) {
      refund = await stripe.refunds.create({
        payment_intent: claim.paymentIntentId,
        amount: claim.amount,
        metadata: {
          refund_id: claim.refundId,
          refund_reference: claim.refundReference,
          order_id: row.order_id,
        },
      }, { idempotencyKey: `order-refund:${claim.refundId}:v1` });
    }
    if (!refundMatchesClaim(refund, claim)) throw new Error("REFUND_MISMATCH");
    const { error: finalizeError } = await admin.rpc(
      "finalize_order_refund_v1",
      {
        p_refund_id: claim.refundId,
        p_stripe_refund_id: refund.id,
      },
    );
    if (finalizeError) throw finalizeError;
    await admin.rpc("create_refund_liability_v1", {
      p_refund_id: claim.refundId,
    });
    return json({ status: "succeeded" }, 200, false);
  } catch (caught) {
    await admin.rpc("mark_order_refund_reconciling_v1", {
      p_refund_id: claim.refundId,
      p_failure_code: safeErrorCode(caught),
    });
    return json({ status: "reconciling" }, 202, false);
  }
});

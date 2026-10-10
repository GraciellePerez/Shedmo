import {
  authenticatedHandler,
  parseObject,
  requireUuid,
} from "../_shared/fulfillment.ts";
import { safeErrorCode } from "../_shared/http.ts";
import { isDefiniteStripeRejection } from "../_shared/payoutReconciliation.ts";
import {
  recoverRefund,
  recoverReversal,
  type RefundClaim,
  refundMatchesClaim,
  type ReversalClaim,
  reversalMatchesClaim,
} from "../_shared/refundReconciliation.ts";
import { createStripeClient } from "../_shared/server.ts";

authenticatedHandler("cancel_order", async (request, admin, user) => {
  const body = await parseObject(request, ["orderId"]);
  const orderId = requireUuid(body.orderId);
  const { data: order, error: orderError } = await admin.from("orders")
    .select("buyer_id,seller_id").eq("id", orderId).single();
  if (orderError || !order) throw orderError ?? new Error("ORDER_NOT_FOUND");
  const role = order.buyer_id === user.id
    ? "buyer"
    : order.seller_id === user.id
    ? "seller"
    : null;
  if (!role) throw new Error("ORDER_ACCESS_DENIED");
  const { data: canceled, error: cancelError } = await admin.rpc(
    "cancel_order_v1",
    {
      p_order_id: orderId,
      p_actor_id: user.id,
      p_actor_role: role,
    },
  ).single();
  if (cancelError || !canceled) throw cancelError ?? new Error("CANCEL_FAILED");
  if (!(canceled as { requires_refund: boolean }).requires_refund) {
    return { orderId, status: "canceled" };
  }
  return await refundCanceledOrder(admin, orderId, user.id, role);
});

async function refundCanceledOrder(
  admin: any,
  orderId: string,
  userId: string,
  role: "buyer" | "seller",
) {
  const reason = role === "buyer"
    ? "buyer_cancellation"
    : "seller_cancellation";
  const { data, error } = await admin.rpc("prepare_order_refund_v1", {
    p_order_id: orderId,
    p_reason: reason,
    p_requested_by: userId,
    p_amount: null,
  }).single();
  if (error || !data) throw error ?? new Error("REFUND_PREPARE_FAILED");
  const row = data as any;
  const claim: RefundClaim = {
    refundId: row.refund_id,
    status: row.refund_status,
    stripeRefundId: row.stripe_refund_id,
    refundReference: row.refund_reference,
    paymentIntentId: row.payment_intent_id,
    amount: Number(row.amount),
    currency: row.currency,
  };
  const stripe = createStripeClient();
  const { data: release } = await admin.from("seller_payout_releases")
    .select("status").eq("order_id", orderId).maybeSingle();
  if (release?.status === "transferred") {
    await reverseSellerTransfer(admin, stripe, claim.refundId);
  }
  let refund;
  try {
    refund = await recoverRefund(stripe, claim);
    if (!refund) {
      refund = await stripe.refunds.create({
        payment_intent: claim.paymentIntentId,
        amount: claim.amount,
        metadata: {
          refund_id: claim.refundId,
          refund_reference: claim.refundReference,
          order_id: orderId,
        },
      }, { idempotencyKey: `order-refund:${claim.refundId}:v1` });
    }
  } catch (caught) {
    await admin.rpc("mark_order_refund_reconciling_v1", {
      p_refund_id: claim.refundId,
      p_failure_code: safeErrorCode(caught),
    });
    if (isDefiniteStripeRejection(caught)) throw caught;
    return { orderId, status: "reconciling" };
  }
  if (!refundMatchesClaim(refund, claim)) throw new Error("REFUND_MISMATCH");
  const { error: finalizeError } = await admin.rpc("finalize_order_refund_v1", {
    p_refund_id: claim.refundId,
    p_stripe_refund_id: refund.id,
  });
  if (finalizeError) {
    await admin.rpc("mark_order_refund_reconciling_v1", {
      p_refund_id: claim.refundId,
      p_failure_code: safeErrorCode(finalizeError),
    });
    return { orderId, status: "reconciling" };
  }
  await admin.rpc("create_refund_liability_v1", {
    p_refund_id: claim.refundId,
  });
  return { orderId, status: "refunded" };
}

async function reverseSellerTransfer(
  admin: any,
  stripe: ReturnType<typeof createStripeClient>,
  refundId: string,
) {
  const { data, error } = await admin.rpc("prepare_transfer_reversal_v1", {
    p_refund_id: refundId,
  }).single();
  if (error || !data) throw error ?? new Error("REVERSAL_PREPARE_FAILED");
  const row = data as any;
  const claim: ReversalClaim = {
    reversalId: row.reversal_id,
    status: row.reversal_status,
    stripeReversalId: row.stripe_reversal_id,
    reversalReference: row.reversal_reference,
    transferId: row.transfer_id,
    amount: Number(row.amount),
    currency: row.currency,
  };
  let reversal;
  try {
    reversal = await recoverReversal(stripe, claim);
    if (!reversal) {
      reversal = await stripe.transfers.createReversal(claim.transferId, {
        amount: claim.amount,
        metadata: {
          reversal_id: claim.reversalId,
          reversal_reference: claim.reversalReference,
        },
      }, { idempotencyKey: `transfer-reversal:${claim.reversalId}:v1` });
    }
  } catch (caught) {
    await admin.rpc("mark_transfer_reversal_reconciling_v1", {
      p_reversal_id: claim.reversalId,
      p_failure_code: safeErrorCode(caught),
    });
    throw caught;
  }
  if (!reversalMatchesClaim(reversal, claim)) {
    throw new Error("REVERSAL_MISMATCH");
  }
  const { error: finalizeError } = await admin.rpc(
    "finalize_transfer_reversal_v1",
    {
      p_reversal_id: claim.reversalId,
      p_stripe_reversal_id: reversal.id,
    },
  );
  if (finalizeError) {
    await admin.rpc("mark_transfer_reversal_reconciling_v1", {
      p_reversal_id: claim.reversalId,
      p_failure_code: safeErrorCode(finalizeError),
    });
    throw finalizeError;
  }
}

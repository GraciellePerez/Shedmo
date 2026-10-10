import type Stripe from "npm:stripe@22.4.0";

export interface RefundClaim {
  refundId: string;
  status: string;
  stripeRefundId: string | null;
  refundReference: string;
  paymentIntentId: string;
  amount: number;
  currency: "usd";
}

export interface ReversalClaim {
  reversalId: string;
  status: string;
  stripeReversalId: string | null;
  reversalReference: string;
  transferId: string;
  amount: number;
  currency: "usd";
}

export const recoverRefund = async (stripe: Stripe, claim: RefundClaim) => {
  if (claim.stripeRefundId) {
    const refund = await stripe.refunds.retrieve(claim.stripeRefundId);
    return refundMatchesClaim(refund, claim) ? refund : null;
  }
  const refunds = await stripe.refunds.list({
    payment_intent: claim.paymentIntentId,
    limit: 100,
  });
  return refunds.data.find((refund) => refundMatchesClaim(refund, claim)) ??
    null;
};

export const refundMatchesClaim = (refund: Stripe.Refund, claim: RefundClaim) =>
  refund.amount === claim.amount && refund.currency === claim.currency &&
  refund.metadata?.refund_id === claim.refundId &&
  refund.metadata?.refund_reference === claim.refundReference;

export const recoverReversal = async (stripe: Stripe, claim: ReversalClaim) => {
  const reversals = await stripe.transfers.listReversals(claim.transferId, {
    limit: 100,
  });
  return reversals.data.find((reversal) =>
    reversal.id === claim.stripeReversalId ||
    reversalMatchesClaim(reversal, claim)
  ) ?? null;
};

export const reversalMatchesClaim = (
  reversal: Stripe.TransferReversal,
  claim: ReversalClaim,
) =>
  reversal.amount === claim.amount && reversal.currency === claim.currency &&
  reversal.metadata?.reversal_id === claim.reversalId &&
  reversal.metadata?.reversal_reference === claim.reversalReference;

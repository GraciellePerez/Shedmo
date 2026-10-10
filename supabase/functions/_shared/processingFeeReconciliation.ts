import type Stripe from "npm:stripe@22.4.0";

export interface ProcessingFeeClaim {
  paymentId: string;
  chargeId: string;
  amount: number;
  currency: "usd";
}

export const retrieveProcessingFee = async (
  stripe: Stripe,
  claim: ProcessingFeeClaim,
) => {
  const charge = await stripe.charges.retrieve(claim.chargeId, {
    expand: ["balance_transaction"],
  });
  if (
    charge.amount !== claim.amount || charge.currency !== claim.currency ||
    !charge.paid
  ) {
    throw new Error("CHARGE_MISMATCH");
  }
  const transaction = charge.balance_transaction;
  if (!transaction || typeof transaction === "string") return null;
  if (
    transaction.currency !== claim.currency ||
    transaction.source !== charge.id || transaction.fee < 0
  ) {
    throw new Error("BALANCE_TRANSACTION_MISMATCH");
  }
  return { balanceTransactionId: transaction.id, feeAmount: transaction.fee };
};

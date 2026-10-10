import type Stripe from "npm:stripe@22.4.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";

import { safeErrorCode } from "./http.ts";

export interface PayoutClaim {
  releaseId: string;
  orderId: string;
  status: "creating" | "reconciling" | "transferred" | "settled" | "failed";
  stripeTransferId: string | null;
  transferReference: string;
  destinationAccountId: string;
  sourceChargeId: string;
  amount: number;
  currency: "usd";
  transferVersion: 1;
}

const expandableId = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id ?? null;

export const transferMatchesClaim = (
  transfer: Stripe.Transfer,
  claim: PayoutClaim,
) =>
  transfer.amount === claim.amount && transfer.currency === claim.currency &&
  expandableId(transfer.destination) === claim.destinationAccountId &&
  expandableId(transfer.source_transaction) === claim.sourceChargeId &&
  transfer.transfer_group === claim.transferReference &&
  transfer.metadata.payout_release_id === claim.releaseId &&
  transfer.metadata.order_id === claim.orderId;

export const recoverTransfer = async (
  stripe: Stripe,
  claim: PayoutClaim,
): Promise<Stripe.Transfer | null> => {
  if (claim.stripeTransferId) {
    const transfer = await stripe.transfers.retrieve(claim.stripeTransferId);
    if (!transferMatchesClaim(transfer, claim)) {
      throw new Error("TRANSFER_MISMATCH");
    }
    return transfer;
  }

  const transfers = await stripe.transfers.list({
    transfer_group: claim.transferReference,
    limit: 100,
  });
  const matches = transfers.data.filter((transfer) =>
    transferMatchesClaim(transfer, claim)
  );
  if (
    matches.length === 1 && transfers.data.length === 1 && !transfers.has_more
  ) return matches[0];
  if (transfers.data.length > 0 || transfers.has_more) {
    throw new Error("TRANSFER_REFERENCE_CONFLICT");
  }
  return null;
};

export const isDefiniteStripeRejection = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const type = (error as { type?: unknown }).type;
  return type === "StripeInvalidRequestError" ||
    type === "StripeAuthenticationError" ||
    type === "StripePermissionError" || type === "StripeCardError";
};

export const markReconciling = async (
  admin: SupabaseClient,
  releaseId: string,
  error: unknown,
) => {
  await admin.rpc("mark_seller_payout_reconciling_v2", {
    p_release_id: releaseId,
    p_reason_code: safeErrorCode(error),
  });
};

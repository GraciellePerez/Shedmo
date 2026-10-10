import {
  authenticatedHandler,
  parseObject,
  requireUuid,
} from "../_shared/fulfillment.ts";
import { createStripeClient } from "../_shared/server.ts";
import { safeErrorCode } from "../_shared/http.ts";
import {
  isDefiniteStripeRejection,
  markReconciling,
  type PayoutClaim,
  recoverTransfer,
  transferMatchesClaim,
} from "../_shared/payoutReconciliation.ts";

authenticatedHandler("release_seller_payout", async (request, admin, user) => {
  const body = await parseObject(request, ["orderId"]);
  const orderId = requireUuid(body.orderId);
  const { data, error } = await admin.rpc("prepare_seller_payout_v2", {
    p_order_id: orderId,
    p_seller_id: user.id,
  }).single();
  if (error) throw error;
  if (!data) throw new Error("PAYOUT_CLAIM_FAILED");
  const row = data as {
    release_id: string;
    release_status: PayoutClaim["status"];
    stripe_transfer_id: string | null;
    transfer_reference: string;
    destination_account_id: string;
    source_charge_id: string;
    amount: number;
    currency: "usd";
    transfer_version: 1;
  };
  const claim: PayoutClaim = {
    releaseId: row.release_id,
    orderId,
    status: row.release_status,
    stripeTransferId: row.stripe_transfer_id,
    transferReference: row.transfer_reference,
    destinationAccountId: row.destination_account_id,
    sourceChargeId: row.source_charge_id,
    amount: Number(row.amount),
    currency: row.currency,
    transferVersion: row.transfer_version,
  };
  if (claim.status === "transferred") return { orderId, status: "transferred" };
  if (claim.status === "settled") return { orderId, status: "settled" };
  if (claim.status === "failed") throw new Error("PAYOUT_REJECTED");

  const stripe = createStripeClient();
  let transfer;
  try {
    transfer = await recoverTransfer(stripe, claim);
  } catch (error) {
    await markReconciling(admin, claim.releaseId, error).catch(() => undefined);
    return {
      orderId,
      status: "reconciling",
      message: "Payout is being verified.",
    };
  }

  if (!transfer) {
    try {
      transfer = await stripe.transfers.create({
        amount: Number(claim.amount),
        currency: claim.currency,
        destination: claim.destinationAccountId,
        source_transaction: claim.sourceChargeId,
        transfer_group: claim.transferReference,
        metadata: { payout_release_id: claim.releaseId, order_id: orderId },
      }, {
        idempotencyKey:
          `seller-payout:${claim.releaseId}:v${claim.transferVersion}`,
      });
    } catch (error) {
      if (isDefiniteStripeRejection(error)) {
        await admin.rpc("fail_seller_payout_v2", {
          p_release_id: claim.releaseId,
          p_failure_code: safeErrorCode(error),
        });
        throw error;
      }
      await markReconciling(admin, claim.releaseId, error).catch(() =>
        undefined
      );
      return {
        orderId,
        status: "reconciling",
        message: "Payout is being verified.",
      };
    }
  }

  if (!transferMatchesClaim(transfer, claim)) {
    await markReconciling(
      admin,
      claim.releaseId,
      new Error("TRANSFER_MISMATCH"),
    ).catch(() => undefined);
    return {
      orderId,
      status: "reconciling",
      message: "Payout is being verified.",
    };
  }

  const { error: recordError } = await admin.rpc("record_seller_transfer_v2", {
    p_release_id: claim.releaseId,
    p_transfer_id: transfer.id,
  });
  if (recordError) {
    await markReconciling(admin, claim.releaseId, recordError).catch(() =>
      undefined
    );
    return {
      orderId,
      status: "reconciling",
      message: "Payout is being verified.",
    };
  }
  const { error: finalizeError } = await admin.rpc(
    "finalize_seller_payout_v2",
    {
      p_release_id: claim.releaseId,
      p_transfer_id: transfer.id,
    },
  );
  if (finalizeError) {
    await markReconciling(admin, claim.releaseId, finalizeError).catch(() =>
      undefined
    );
    return {
      orderId,
      status: "reconciling",
      message: "Payout is being verified.",
    };
  }
  return { orderId, status: "transferred" };
});

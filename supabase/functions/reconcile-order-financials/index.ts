import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import Stripe from "npm:stripe@22.4.0";

import { json } from "../_shared/http.ts";
import {
  type PayoutClaim,
  recoverTransfer,
  transferMatchesClaim,
} from "../_shared/payoutReconciliation.ts";
import {
  recoverRefund,
  recoverReversal,
  refundMatchesClaim,
  reversalMatchesClaim,
} from "../_shared/refundReconciliation.ts";
import { retrieveProcessingFee } from "../_shared/processingFeeReconciliation.ts";

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
  const admin = createClient(required("SUPABASE_URL"), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const runId=crypto.randomUUID();
  await admin.from("marketplace_reconciliation_runs").insert({id:runId,status:"running"});
  const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
  const { data: expired, error: expiryError } = await admin.rpc(
    "expire_order_inspections_v1",
    { p_limit: 100 },
  );
  if (expiryError) {
    await admin.from("marketplace_reconciliation_runs").update({status:"failed",finished_at:new Date().toISOString(),safe_result:{stage:"inspection_expiry"}}).eq("id",runId);
    return json({ error: "Inspection reconciliation failed." }, 500, false);
  }

  const result = {
    inspectionsExpired: Number(expired ?? 0),
    processingFeesReconciled: 0,
    payoutsReleased: 0,
    transfersRecovered: 0,
    refundsRecovered: 0,
    reversalsRecovered: 0,
    refundLiabilitiesReconciled: 0,
  };
  const { data: feePayments } = await admin.from("payments")
    .select("id,stripe_charge_id,amount,currency")
    .in("status", [
      "succeeded",
      "refund_pending",
      "partially_refunded",
      "refunded",
      "disputed",
    ])
    .in("processing_fee_status", ["pending", "reconciling"])
    .not("stripe_charge_id", "is", null).order("updated_at").limit(50);
  for (const payment of feePayments ?? []) {
    try {
      const fee = await retrieveProcessingFee(stripe, {
        paymentId: payment.id,
        chargeId: payment.stripe_charge_id,
        amount: Number(payment.amount),
        currency: payment.currency,
      });
      if (!fee) {
        await admin.rpc("mark_payment_processing_fee_reconciling_v1", {
          p_payment_id: payment.id,
        });
        continue;
      }
      const { error } = await admin.rpc("reconcile_payment_processing_fee_v1", {
        p_payment_id: payment.id,
        p_charge_id: payment.stripe_charge_id,
        p_balance_transaction_id: fee.balanceTransactionId,
        p_fee_amount: fee.feeAmount,
        p_currency: payment.currency,
      });
      if (!error) result.processingFeesReconciled++;
    } catch {
      await admin.rpc("mark_payment_processing_fee_reconciling_v1", {
        p_payment_id: payment.id,
      });
    }
  }
  const { data: settledRefunds } = await admin.from("order_refunds")
    .select("id").eq("status", "succeeded").order("updated_at").limit(50);
  for (const refund of settledRefunds ?? []) {
    const { error } = await admin.rpc("create_refund_liability_v1", {
      p_refund_id: refund.id,
    });
    if (!error) result.refundLiabilitiesReconciled++;
  }
  const { data: dueOrders } = await admin.from("orders")
    .select("id,seller_id").eq("transfer_status", "eligible")
    .lte("payout_not_before", new Date().toISOString())
    .order("payout_not_before").limit(50);
  for (const order of dueOrders ?? []) {
    const { data: claimRow, error: claimError } = await admin.rpc(
      "prepare_seller_payout_v2",
      { p_order_id: order.id, p_seller_id: order.seller_id },
    ).single();
    if (claimError || !claimRow) continue;
    const trustedClaim = claimRow as {
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
      releaseId: trustedClaim.release_id,
      orderId: order.id,
      status: trustedClaim.release_status,
      stripeTransferId: trustedClaim.stripe_transfer_id,
      transferReference: trustedClaim.transfer_reference,
      destinationAccountId: trustedClaim.destination_account_id,
      sourceChargeId: trustedClaim.source_charge_id,
      amount: Number(trustedClaim.amount),
      currency: trustedClaim.currency,
      transferVersion: trustedClaim.transfer_version,
    };
    if (claim.status === "settled") continue;
    try {
      let transfer = await recoverTransfer(stripe, claim);
      if (!transfer) {
        transfer = await stripe.transfers.create({
          amount: claim.amount,
          currency: claim.currency,
          destination: claim.destinationAccountId,
          source_transaction: claim.sourceChargeId,
          transfer_group: claim.transferReference,
          metadata: {
            payout_release_id: claim.releaseId,
            order_id: claim.orderId,
          },
        }, {
          idempotencyKey:
            `seller-payout:${claim.releaseId}:v${claim.transferVersion}`,
        });
      }
      if (!transferMatchesClaim(transfer, claim)) continue;
      const { error } = await admin.rpc("finalize_seller_payout_v2", {
        p_release_id: claim.releaseId,
        p_transfer_id: transfer.id,
      });
      if (!error) result.payoutsReleased++;
    } catch {
      await admin.rpc("mark_seller_payout_reconciling_v2", {
        p_release_id: claim.releaseId,
        p_reason_code: "SCHEDULED_TRANSFER_UNCERTAIN",
      });
    }
  }
  const { data: releases } = await admin.from("seller_payout_releases")
    .select(
      "id,order_id,status,stripe_transfer_id,transfer_reference,destination_account_id,source_charge_id,amount,currency,transfer_version",
    )
    .eq("status", "reconciling").order("updated_at").limit(50);
  for (const row of releases ?? []) {
    const claim: PayoutClaim = {
      releaseId: row.id,
      orderId: row.order_id,
      status: row.status,
      stripeTransferId: row.stripe_transfer_id,
      transferReference: row.transfer_reference,
      destinationAccountId: row.destination_account_id,
      sourceChargeId: row.source_charge_id,
      amount: Number(row.amount),
      currency: row.currency,
      transferVersion: row.transfer_version,
    };
    let transfer = await recoverTransfer(stripe, claim).catch(() => null);
    if (!transfer) {
      transfer = await stripe.transfers.create({
        amount: claim.amount,
        currency: claim.currency,
        destination: claim.destinationAccountId,
        source_transaction: claim.sourceChargeId,
        transfer_group: claim.transferReference,
        metadata: {
          payout_release_id: claim.releaseId,
          order_id: claim.orderId,
        },
      }, {
        idempotencyKey:
          `seller-payout:${claim.releaseId}:v${claim.transferVersion}`,
      }).catch(() => null);
    }
    if (!transfer || !transferMatchesClaim(transfer, claim)) continue;
    const { error } = await admin.rpc("finalize_seller_payout_v2", {
      p_release_id: claim.releaseId,
      p_transfer_id: transfer.id,
    });
    if (!error) result.transfersRecovered++;
  }

  const { data: refunds } = await admin.from("order_refunds")
    .select(
      "id,order_id,status,stripe_refund_id,refund_reference,stripe_payment_intent_id,amount,currency",
    )
    .in("status", ["creating", "reconciling"]).order("updated_at").limit(50);
  for (const row of refunds ?? []) {
    const claim = {
      refundId: row.id,
      status: row.status,
      stripeRefundId: row.stripe_refund_id,
      refundReference: row.refund_reference,
      paymentIntentId: row.stripe_payment_intent_id,
      amount: Number(row.amount),
      currency: row.currency as "usd",
    };
    let refund = await recoverRefund(stripe, claim).catch(() => null);
    if (!refund) {
      refund = await stripe.refunds.create({
        payment_intent: claim.paymentIntentId,
        amount: claim.amount,
        metadata: {
          refund_id: claim.refundId,
          refund_reference: claim.refundReference,
          order_id: row.order_id,
        },
      }, {
        idempotencyKey: `order-refund:${claim.refundId}:v1`,
      }).catch(() => null);
    }
    if (!refund || !refundMatchesClaim(refund, claim)) continue;
    const { error } = await admin.rpc("finalize_order_refund_v1", {
      p_refund_id: claim.refundId,
      p_stripe_refund_id: refund.id,
    });
    if (!error) {
      await admin.rpc("create_refund_liability_v1", {
        p_refund_id: claim.refundId,
      });
      result.refundsRecovered++;
    }
  }

  const { data: reversals } = await admin.from("transfer_reversals")
    .select(
      "id,status,stripe_reversal_id,reversal_reference,stripe_transfer_id,amount,currency",
    )
    .in("status", ["creating", "reconciling"]).order("updated_at").limit(50);
  for (const row of reversals ?? []) {
    const claim = {
      reversalId: row.id,
      status: row.status,
      stripeReversalId: row.stripe_reversal_id,
      reversalReference: row.reversal_reference,
      transferId: row.stripe_transfer_id,
      amount: Number(row.amount),
      currency: row.currency as "usd",
    };
    let reversal = await recoverReversal(stripe, claim).catch(() => null);
    if (!reversal) {
      reversal = await stripe.transfers.createReversal(claim.transferId, {
        amount: claim.amount,
        metadata: {
          reversal_id: claim.reversalId,
          reversal_reference: claim.reversalReference,
        },
      }, {
        idempotencyKey: `transfer-reversal:${claim.reversalId}:v1`,
      }).catch(() => null);
    }
    if (!reversal || !reversalMatchesClaim(reversal, claim)) continue;
    const { error } = await admin.rpc("finalize_transfer_reversal_v1", {
      p_reversal_id: claim.reversalId,
      p_stripe_reversal_id: reversal.id,
    });
    if (!error) result.reversalsRecovered++;
  }
  console.info("Phase D3 financial reconciliation completed", result);
  await admin.from("marketplace_reconciliation_runs").update({status:"succeeded",finished_at:new Date().toISOString(),safe_result:result}).eq("id",runId);
  return json(result, 200, false);
});

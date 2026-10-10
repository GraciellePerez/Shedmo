import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.111.0";
import Stripe from "npm:stripe@22.4.0";

import { mapStripeAccountStatus } from "../_shared/connect.ts";
import { accountSuffix, json, safeErrorCode } from "../_shared/http.ts";
import {
  recoverReversal,
  reversalMatchesClaim,
} from "../_shared/refundReconciliation.ts";
import { retrieveProcessingFee } from "../_shared/processingFeeReconciliation.ts";

const requiredEnvironment = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
};

const safeFailureMessage = (code: string) => {
  if (code === "STATUS_PERSIST_FAILED") return "Account status update failed.";
  if (code === "WEBHOOK_CLAIM_FAILED") return "Webhook claim failed.";
  if (code.startsWith("PAYMENT_")) return "Payment event validation failed.";
  return "Webhook event processing failed.";
};

const paymentEventTypes = new Set([
  "payment_intent.processing",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

const financialEventTypes = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.refunded",
  "refund.updated",
  "transfer.reversed",
]);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, false);
  }

  let stripe: Stripe;
  let admin: SupabaseClient;
  let signingSecret: string;
  try {
    stripe = new Stripe(requiredEnvironment("STRIPE_SECRET_KEY"));
    signingSecret = requiredEnvironment("STRIPE_WEBHOOK_SIGNING_SECRET");
    admin = createClient(
      requiredEnvironment("SUPABASE_URL"),
      requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  } catch {
    console.error("Stripe webhook server configuration missing", {
      operation: "stripe_webhook",
    });
    return json({ error: "Server configuration unavailable." }, 500, false);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "Invalid signature." }, 400, false);

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      signingSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    console.warn("Stripe webhook signature rejected", {
      operation: "stripe_webhook",
    });
    return json({ error: "Invalid signature." }, 400, false);
  }

  const supported = event.type === "account.updated" ||
    event.type === "account.application.deauthorized" ||
    paymentEventTypes.has(event.type) || financialEventTypes.has(event.type);
  const initialStatus = supported ? "processing" : "ignored";
  const { data: inserted, error: insertError } = await admin
    .from("stripe_webhook_events")
    .upsert({
      stripe_event_id: event.id,
      event_type: event.type,
      api_version: event.api_version ?? null,
      object_id: typeof event.data.object === "object" && event.data.object &&
          "id" in event.data.object
        ? String(event.data.object.id).slice(0, 255)
        : null,
      processing_status: initialStatus,
      attempt_count: 1,
      processed_at: supported ? null : new Date().toISOString(),
    }, { onConflict: "stripe_event_id", ignoreDuplicates: true })
    .select("stripe_event_id")
    .maybeSingle();

  if (insertError) {
    console.error("Stripe webhook event insert failed", {
      operation: "stripe_webhook",
      eventType: event.type,
      errorCode: insertError.code ?? "UNKNOWN",
    });
    return json({ error: "Event could not be recorded." }, 500, false);
  }

  if (!supported) return json({ received: true, ignored: true }, 200, false);

  if (!inserted) {
    const { data: prior, error: priorError } = await admin
      .from("stripe_webhook_events")
      .select("processing_status,attempt_count,updated_at")
      .eq("stripe_event_id", event.id)
      .single();
    if (priorError) {
      return json({ error: "Event state unavailable." }, 500, false);
    }
    const processingIsFresh = prior.processing_status === "processing" &&
      Date.now() - new Date(prior.updated_at).getTime() < 2 * 60 * 1000;
    if (prior.processing_status === "processed" || processingIsFresh) {
      return json({ received: true, duplicate: true }, 200, false);
    }

    const { data: claimed, error: claimError } = await admin
      .from("stripe_webhook_events")
      .update({
        processing_status: "processing",
        attempt_count: Math.min(Number(prior.attempt_count ?? 0) + 1, 1000),
        last_error_code: null,
        last_error_message: null,
      })
      .eq("stripe_event_id", event.id)
      .in("processing_status", ["failed", "processing"])
      .eq("attempt_count", prior.attempt_count)
      .eq("updated_at", prior.updated_at)
      .select("stripe_event_id")
      .maybeSingle();
    if (claimError) return json({ error: "Event claim failed." }, 500, false);
    if (!claimed) return json({ received: true, duplicate: true }, 200, false);
  }

  try {
    let matched = false;
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      const status = mapStripeAccountStatus(account);
      const { data, error } = await admin
        .from("seller_payment_accounts")
        .update({
          onboarding_status: status.onboardingStatus,
          details_submitted: status.detailsSubmitted,
          charges_enabled: status.chargesEnabled,
          payouts_enabled: status.payoutsEnabled,
          transfer_capability_status: status.transferCapabilityStatus,
          disabled_reason: status.disabledReason,
        })
        .eq("stripe_account_id", account.id)
        .select("user_id");
      if (error) throw new Error(`STATUS_PERSIST_${error.code ?? "FAILED"}`);
      matched = Boolean(data?.length);
      console.info("Stripe account.updated processed", {
        operation: "stripe_webhook",
        eventType: event.type,
        accountSuffix: accountSuffix(account.id),
        onboardingStatus: status.onboardingStatus,
        matched,
      });
    } else if (event.type === "account.application.deauthorized") {
      const connectedAccountId = typeof event.account === "string"
        ? event.account
        : null;
      if (connectedAccountId) {
        const { data, error } = await admin
          .from("seller_payment_accounts")
          .update({
            onboarding_status: "disabled",
            details_submitted: false,
            charges_enabled: false,
            payouts_enabled: false,
            transfer_capability_status: "restricted",
            disabled_reason: "platform_disconnected",
          })
          .eq("stripe_account_id", connectedAccountId)
          .select("user_id");
        if (error) throw new Error(`STATUS_PERSIST_${error.code ?? "FAILED"}`);
        matched = Boolean(data?.length);
        console.info("Stripe account deauthorization processed", {
          operation: "stripe_webhook",
          eventType: event.type,
          accountSuffix: accountSuffix(connectedAccountId),
          matched,
        });
      }
    } else if (paymentEventTypes.has(event.type)) {
      const intent = event.data.object as Stripe.PaymentIntent;
      const orderId = intent.metadata?.order_id;
      if (!orderId) throw new Error("PAYMENT_ORDER_METADATA_MISSING");

      const { data: order, error: orderError } = await admin.from("orders")
        .select("id,buyer_id,seller_id,listing_id,total_amount,currency")
        .eq("id", orderId).single();
      const { data: payment, error: paymentError } = await admin.from(
        "payments",
      )
        .select("id,stripe_payment_intent_id,amount,currency")
        .eq("order_id", orderId).single();
      if (orderError || paymentError) {
        throw new Error("PAYMENT_ORDER_NOT_FOUND");
      }
      if (
        payment.stripe_payment_intent_id !== intent.id ||
        Number(payment.amount) !== intent.amount ||
        Number(order.total_amount) !== intent.amount ||
        payment.currency !== intent.currency ||
        order.currency !== intent.currency ||
        intent.metadata.order_id !== order.id ||
        intent.metadata.listing_id !== order.listing_id ||
        intent.metadata.buyer_id !== order.buyer_id ||
        intent.metadata.seller_id !== order.seller_id
      ) throw new Error("PAYMENT_DATA_MISMATCH");

      const status = event.type === "payment_intent.succeeded"
        ? "succeeded"
        : event.type === "payment_intent.processing"
        ? "processing"
        : event.type === "payment_intent.canceled"
        ? "canceled"
        : "failed";
      const latestCharge = intent.latest_charge;
      const chargeId = typeof latestCharge === "string"
        ? latestCharge
        : latestCharge?.id ?? null;
      const failureCode = intent.last_payment_error?.code ?? null;
      const { error: applyError } = await admin.rpc(
        "apply_checkout_payment_event",
        {
          p_order_id: order.id,
          p_payment_intent_id: intent.id,
          p_status: status,
          p_amount: intent.amount,
          p_currency: intent.currency,
          p_charge_id: chargeId,
          p_failure_code: failureCode,
        },
      );
      if (applyError) {
        throw new Error(`PAYMENT_APPLY_${applyError.code ?? "FAILED"}`);
      }
      if (status === "succeeded" && chargeId) {
        try {
          const fee = await retrieveProcessingFee(stripe, {
            paymentId: payment.id,
            chargeId,
            amount: Number(payment.amount),
            currency: payment.currency,
          });
          if (fee) {
            const { error: feeError } = await admin.rpc(
              "reconcile_payment_processing_fee_v1",
              {
                p_payment_id: payment.id,
                p_charge_id: chargeId,
                p_balance_transaction_id: fee.balanceTransactionId,
                p_fee_amount: fee.feeAmount,
                p_currency: payment.currency,
              },
            );
            if (feeError) throw feeError;
          } else {
            await admin.rpc("mark_payment_processing_fee_reconciling_v1", {
              p_payment_id: payment.id,
            });
          }
        } catch {
          await admin.rpc("mark_payment_processing_fee_reconciling_v1", {
            p_payment_id: payment.id,
          });
        }
      }
      matched = true;
      console.info("Stripe payment event processed", {
        operation: "stripe_webhook",
        eventType: event.type,
        paymentStatus: status,
      });
    } else if (event.type.startsWith("charge.dispute.")) {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === "string"
        ? dispute.charge
        : dispute.charge.id;
      const { data: payment, error: paymentError } = await admin.from(
        "payments",
      )
        .select("order_id").eq("stripe_charge_id", chargeId).single();
      if (paymentError || !payment) {
        throw new Error("DISPUTE_PAYMENT_NOT_FOUND");
      }
      const { data: order, error: orderError } = await admin.from("orders")
        .select(
          "buyer_id,seller_id,inspection_expires_at,fulfillment_status,payout_not_before",
        )
        .eq("id", payment.order_id).single();
      if (orderError || !order) throw new Error("DISPUTE_ORDER_NOT_FOUND");
      const closed = event.type === "charge.dispute.closed";
      const won = dispute.status === "won";
      const disputeStatus = closed
        ? (won ? "resolved_seller" : "resolved_buyer")
        : "under_review";
      const { error: disputeError } = await admin.from("order_disputes").upsert(
        {
          order_id: payment.order_id,
          buyer_id: order.buyer_id,
          seller_id: order.seller_id,
          dispute_type: "stripe_chargeback",
          status: disputeStatus,
          stripe_dispute_id: dispute.id,
          inspection_deadline: order.inspection_expires_at,
          resolved_at: closed ? new Date().toISOString() : null,
        },
        { onConflict: "stripe_dispute_id" },
      );
      if (disputeError) {
        throw new Error(`DISPUTE_PERSIST_${disputeError.code ?? "FAILED"}`);
      }
      const { error: freezeError } = await admin.from("orders").update({
        dispute_status: closed ? disputeStatus : "external_chargeback",
        transfer_status: closed && won &&
            ["pickup_confirmed", "delivered", "completed"].includes(
              order.fulfillment_status,
            ) &&
            order.payout_not_before &&
            new Date(order.payout_not_before).getTime() <= Date.now()
          ? "eligible"
          : "on_hold",
        payment_status: closed && won ? "succeeded" : "disputed",
      }).eq("id", payment.order_id);
      if (freezeError) {
        throw new Error(`DISPUTE_FREEZE_${freezeError.code ?? "FAILED"}`);
      }
      if (closed && !won) {
        const { data: reversalRow, error: reversalError } = await admin.rpc(
          "prepare_chargeback_reversal_v1",
          { p_order_id: payment.order_id },
        ).single();
        if (!reversalError && reversalRow) {
          const trustedReversal = reversalRow as {
            reversal_id: string;
            reversal_status: string;
            stripe_reversal_id: string | null;
            reversal_reference: string;
            transfer_id: string;
            amount: number;
            currency: "usd";
          };
          const claim = {
            reversalId: trustedReversal.reversal_id,
            status: trustedReversal.reversal_status,
            stripeReversalId: trustedReversal.stripe_reversal_id,
            reversalReference: trustedReversal.reversal_reference,
            transferId: trustedReversal.transfer_id,
            amount: Number(trustedReversal.amount),
            currency: trustedReversal.currency,
          };
          let reversal = await recoverReversal(stripe, claim);
          if (!reversal) {
            reversal = await stripe.transfers.createReversal(
              claim.transferId,
              {
                amount: claim.amount,
                metadata: {
                  reversal_id: claim.reversalId,
                  reversal_reference: claim.reversalReference,
                },
              },
              { idempotencyKey: `chargeback-reversal:${claim.reversalId}:v1` },
            );
          }
          if (!reversalMatchesClaim(reversal, claim)) {
            throw new Error("CHARGEBACK_REVERSAL_MISMATCH");
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
            throw new Error("CHARGEBACK_REVERSAL_RECONCILING");
          }
        }
      }
      matched = true;
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const { data: payment, error: paymentError } = await admin.from(
        "payments",
      )
        .select("id,order_id,amount").eq("stripe_charge_id", charge.id)
        .single();
      if (paymentError || !payment) throw new Error("REFUND_PAYMENT_NOT_FOUND");
      const refunded = Number(charge.amount_refunded);
      const full = refunded >= Number(payment.amount);
      const { error: updatePaymentError } = await admin.from("payments").update(
        {
          refunded_amount: refunded,
          status: full ? "refunded" : "partially_refunded",
        },
      ).eq("id", payment.id);
      const { error: updateOrderError } = await admin.from("orders").update({
        payment_status: full ? "refunded" : "partially_refunded",
        refund_status: full ? "refunded" : "partially_refunded",
        transfer_status: "on_hold",
      }).eq("id", payment.order_id);
      if (updatePaymentError || updateOrderError) {
        throw new Error("REFUND_PERSIST_FAILED");
      }
      matched = true;
    } else if (event.type === "refund.updated") {
      const refund = event.data.object as Stripe.Refund;
      const refundId = refund.metadata?.refund_id;
      if (refundId && refund.status === "succeeded") {
        const { error } = await admin.rpc("finalize_order_refund_v1", {
          p_refund_id: refundId,
          p_stripe_refund_id: refund.id,
        });
        if (error) throw new Error(`REFUND_FINALIZE_${error.code ?? "FAILED"}`);
        await admin.rpc("create_refund_liability_v1", {
          p_refund_id: refundId,
        });
        matched = true;
      }
    } else if (event.type === "transfer.reversed") {
      const transfer = event.data.object as Stripe.Transfer;
      for (const reversal of transfer.reversals?.data ?? []) {
        const reversalId = reversal.metadata?.reversal_id;
        if (!reversalId) continue;
        const { error } = await admin.rpc("finalize_transfer_reversal_v1", {
          p_reversal_id: reversalId,
          p_stripe_reversal_id: reversal.id,
        });
        if (error) {
          throw new Error(`REVERSAL_FINALIZE_${error.code ?? "FAILED"}`);
        }
        matched = true;
      }
    }

    const { error: completeError } = await admin
      .from("stripe_webhook_events")
      .update({
        processing_status: "processed",
        processed_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      })
      .eq("stripe_event_id", event.id)
      .eq("processing_status", "processing");
    if (completeError) {
      throw new Error(`EVENT_COMPLETE_${completeError.code ?? "FAILED"}`);
    }
    return json({ received: true }, 200, false);
  } catch (error) {
    const code = safeErrorCode(error);
    await admin
      .from("stripe_webhook_events")
      .update({
        processing_status: "failed",
        last_error_code: code,
        last_error_message: safeFailureMessage(code),
      })
      .eq("stripe_event_id", event.id)
      .eq("processing_status", "processing");
    console.error("Stripe webhook processing failed", {
      operation: "stripe_webhook",
      eventType: event.type,
      errorCode: code,
    });
    return json({ error: "Event processing failed." }, 500, false);
  }
});

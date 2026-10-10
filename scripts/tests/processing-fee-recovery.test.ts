import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import type Stripe from "npm:stripe@22.4.0";

import { retrieveProcessingFee } from "../../supabase/functions/_shared/processingFeeReconciliation.ts";

const claim = {
  paymentId: "payment",
  chargeId: "ch_test",
  amount: 5000,
  currency: "usd" as const,
};

Deno.test("processing fee unavailable remains retryable then reconciles exactly", async () => {
  let available = false;
  const stripe = {
    charges: {
      retrieve: () =>
        Promise.resolve({
          id: claim.chargeId,
          amount: claim.amount,
          currency: claim.currency,
          paid: true,
          balance_transaction: available
            ? {
              id: "txn_test",
              fee: 175,
              currency: "usd",
              source: claim.chargeId,
            }
            : null,
        }),
    },
  } as unknown as Stripe;
  assertEquals(await retrieveProcessingFee(stripe, claim), null);
  available = true;
  assertEquals(await retrieveProcessingFee(stripe, claim), {
    balanceTransactionId: "txn_test",
    feeAmount: 175,
  });
});

Deno.test("mismatched Stripe charge is rejected without persisting a fee", async () => {
  const stripe = {
    charges: {
      retrieve: () =>
        Promise.resolve({
          id: claim.chargeId,
          amount: 4999,
          currency: "usd",
          paid: true,
          balance_transaction: null,
        }),
    },
  } as unknown as Stripe;
  await assertRejects(
    () => retrieveProcessingFee(stripe, claim),
    Error,
    "CHARGE_MISMATCH",
  );
});

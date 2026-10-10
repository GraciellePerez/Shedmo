import { assertEquals } from "jsr:@std/assert@1.0.14";

import {
  recoverRefund,
  recoverReversal,
  type RefundClaim,
  refundMatchesClaim,
  type ReversalClaim,
  reversalMatchesClaim,
} from "../../supabase/functions/_shared/refundReconciliation.ts";

const refundClaim: RefundClaim = {
  refundId: "11111111-1111-4111-8111-111111111111",
  status: "reconciling",
  stripeRefundId: null,
  refundReference: "order_refund_111",
  paymentIntentId: "pi_trusted",
  amount: 1000,
  currency: "usd",
};
const refund = {
  id: "re_1",
  amount: 1000,
  currency: "usd",
  metadata: {
    refund_id: refundClaim.refundId,
    refund_reference: refundClaim.refundReference,
  },
};

Deno.test("refund recovery uses trusted payment intent and metadata", async () => {
  const stripe = {
    refunds: {
      list: (input: unknown) => {
        assertEquals(input, { payment_intent: "pi_trusted", limit: 100 });
        return Promise.resolve({ data: [refund] });
      },
    },
  };
  assertEquals((await recoverRefund(stripe as never, refundClaim))?.id, "re_1");
  assertEquals(
    refundMatchesClaim({ ...refund, amount: 999 } as never, refundClaim),
    false,
  );
});

const reversalClaim: ReversalClaim = {
  reversalId: "22222222-2222-4222-8222-222222222222",
  status: "reconciling",
  stripeReversalId: null,
  reversalReference: "transfer_reversal_222",
  transferId: "tr_trusted",
  amount: 800,
  currency: "usd",
};
const reversal = {
  id: "trr_1",
  amount: 800,
  currency: "usd",
  metadata: {
    reversal_id: reversalClaim.reversalId,
    reversal_reference: reversalClaim.reversalReference,
  },
};

Deno.test("reversal recovery is scoped to the trusted original transfer", async () => {
  const stripe = {
    transfers: {
      listReversals: (transferId: string) => {
        assertEquals(transferId, "tr_trusted");
        return Promise.resolve({ data: [reversal] });
      },
    },
  };
  assertEquals(
    (await recoverReversal(stripe as never, reversalClaim))?.id,
    "trr_1",
  );
  assertEquals(
    reversalMatchesClaim({ ...reversal, amount: 801 } as never, reversalClaim),
    false,
  );
});

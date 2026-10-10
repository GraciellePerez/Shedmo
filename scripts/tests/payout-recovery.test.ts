import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";

import {
  type PayoutClaim,
  recoverTransfer,
  transferMatchesClaim,
} from "../../supabase/functions/_shared/payoutReconciliation.ts";

const claim: PayoutClaim = {
  releaseId: "11111111-1111-4111-8111-111111111111",
  orderId: "22222222-2222-4222-8222-222222222222",
  status: "reconciling",
  stripeTransferId: null,
  transferReference: "payout_release_11111111111141118111111111111111",
  destinationAccountId: "acct_server_stored",
  sourceChargeId: "ch_webhook_derived",
  amount: 8500,
  currency: "usd",
  transferVersion: 1,
};

const transfer = {
  id: "tr_recovered",
  amount: 8500,
  currency: "usd",
  destination: "acct_server_stored",
  source_transaction: "ch_webhook_derived",
  transfer_group: claim.transferReference,
  metadata: { payout_release_id: claim.releaseId, order_id: claim.orderId },
};

Deno.test("existing transfer is recovered by reference after simulated idempotency expiry", async () => {
  let creates = 0;
  const stripe = {
    transfers: {
      list: () => Promise.resolve({ data: [transfer], has_more: false }),
      retrieve: () => Promise.reject(new Error("not used")),
      create: () => {
        creates++;
      },
    },
  };
  const recovered = await recoverTransfer(stripe as never, claim);
  assertEquals(recovered?.id, "tr_recovered");
  assertEquals(creates, 0);
});

Deno.test("persisted transfer ID is retrieved and validated", async () => {
  const stripe = {
    transfers: {
      retrieve: () => Promise.resolve(transfer),
      list: () => Promise.reject(new Error("not used")),
    },
  };
  const recovered = await recoverTransfer(stripe as never, {
    ...claim,
    stripeTransferId: "tr_recovered",
  });
  assertEquals(recovered?.id, "tr_recovered");
});

Deno.test("no transfer is returned only after an empty stable-reference search", async () => {
  const stripe = {
    transfers: {
      list: () => Promise.resolve({ data: [], has_more: false }),
    },
  };
  assertEquals(await recoverTransfer(stripe as never, claim), null);
});

Deno.test("reference conflict blocks creation instead of selecting an unsafe transfer", async () => {
  const stripe = {
    transfers: {
      list: () =>
        Promise.resolve({
          data: [{ ...transfer, amount: 1 }],
          has_more: false,
        }),
    },
  };
  await assertRejects(
    () => recoverTransfer(stripe as never, claim),
    Error,
    "TRANSFER_REFERENCE_CONFLICT",
  );
});

Deno.test("transfer validation includes amount recipient source group and metadata", () => {
  assertEquals(transferMatchesClaim(transfer as never, claim), true);
  assertEquals(
    transferMatchesClaim(
      { ...transfer, destination: "acct_client_supplied" } as never,
      claim,
    ),
    false,
  );
});

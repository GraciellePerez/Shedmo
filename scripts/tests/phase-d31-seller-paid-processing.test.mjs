import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202608060019_add_d31_seller_paid_processing.sql', 'utf8');
const webhook = readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8');
const reconcile = readFileSync('supabase/functions/reconcile-order-financials/index.ts', 'utf8');
const feeHelper = readFileSync('supabase/functions/_shared/processingFeeReconciliation.ts', 'utf8');
const repository = readFileSync('src/features/checkout/checkoutRepository.ts', 'utf8');

test('actual processing fee comes from expanded trusted Stripe balance transaction', () => {
  assert.match(feeHelper, /charges\.retrieve\(claim\.chargeId/);
  assert.match(feeHelper, /expand: \["balance_transaction"\]/);
  assert.match(feeHelper, /transaction\.fee/);
  assert.match(migration, /actual_processing_fee_amount bigint/);
  assert.match(webhook, /reconcile_payment_processing_fee_v1/);
  assert.doesNotMatch(repository, /processing_fee_status|stripe_balance_transaction_id/);
});

test('payout blocks until fee is reconciled and uses exact seller-paid formula', () => {
  assert.match(migration, /processing_fee_status <> 'reconciled'/);
  assert.match(migration, /v_order\.item_amount \+ v_order\.shipping_amount\s+- v_order\.marketplace_fee_amount - v_payment\.actual_processing_fee_amount - v_order\.reserve_withheld_amount/);
  assert.doesNotMatch(migration.match(/create or replace function public\.prepare_seller_payout_v2[\s\S]*?\n\$\$;/)?.[0] ?? '', /0\.029|30\b/);
});

test('partial refunds reduce seller entitlement first and may resume payout', () => {
  assert.match(migration, /v_refund_deduction := least\(v_original, v_refunds\)/);
  assert.match(migration, /v_amount := v_original - v_refund_deduction/);
  assert.match(migration, /v_amount := least\(v_refund\.amount, v_release\.amount - v_prior\)/);
  assert.match(migration, /transfer_status=case when v_remaining > 0 then 'eligible'/);
});

test('refund liabilities and future payout adjustments are idempotent and bounded', () => {
  assert.match(migration, /source_ref text not null unique/);
  assert.match(migration, /on conflict\(source_ref\) do nothing/);
  assert.match(migration, /v_take := least\(v_amount, v_adjustment\.remaining_amount\)/);
  assert.match(migration, /status='settled'/);
  assert.match(migration, /remaining_amount between 0 and amount/);
  assert.match(migration, /seller_payout_adjustment_applications/);
  assert.match(migration, /delete from public\.seller_payout_adjustment_applications/);
});

test('fee reconciliation retries without adding webhook event types', () => {
  assert.match(reconcile, /processing_fee_status/);
  assert.match(reconcile, /retrieveProcessingFee/);
  assert.match(reconcile, /limit\(50\)/);
  assert.doesNotMatch(webhook, /balance_transaction\.(?:created|updated)/);
});

test('marketplace fee remains item-only tiered with one-dollar minimum', () => {
  const foundation = readFileSync('supabase/migrations/202607310013_add_order_payment_foundation.sql', 'utf8');
  assert.match(foundation, /return greatest\(v_fee, 100\)/);
  assert.match(foundation, /least\(p_item_amount, 100000\)/);
  assert.match(foundation, /greatest\(p_item_amount - 100000, 0\)/);
  assert.doesNotMatch(foundation.match(/create or replace function public\.calculate_marketplace_fee_cents[\s\S]*?\n\$\$;/)?.[0] ?? '', /shipping/);
});

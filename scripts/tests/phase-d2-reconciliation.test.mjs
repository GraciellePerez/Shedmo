import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202608060017_fix_phase_d2_release_reconciliation.sql', 'utf8');
const payout = readFileSync('supabase/functions/release-seller-payout/index.ts', 'utf8');
const recovery = readFileSync('supabase/functions/_shared/payoutReconciliation.ts', 'utf8');
const pickup = readFileSync('supabase/functions/complete-pickup/index.ts', 'utf8');
const screen = readFileSync('src/features/fulfillment/FulfillmentOrderScreen.tsx', 'utf8');

test('trusted transfer inputs are persisted before Stripe and hidden from clients', () => {
  for (const column of ['seller_id', 'source_charge_id', 'destination_account_id', 'transfer_reference']) {
    assert.match(migration, new RegExp(`add column ${column}`));
  }
  assert.match(migration, /grant select \(\s*order_id, amount, currency, status, transferred_at, created_at, updated_at\s*\)/s);
  assert.doesNotMatch(migration, /grant select[^;]*(?:source_charge_id|destination_account_id)[^;]*to authenticated/is);
});

test('Stripe success plus DB finalization failure remains reconciling', () => {
  assert.match(payout, /if \(finalizeError\)[\s\S]*markReconciling[\s\S]*status: "reconciling"/);
  assert.doesNotMatch(payout, /finalizeError[\s\S]{0,300}fail_seller_payout/);
});

test('timeout or ambiguous Stripe response never transitions to failed', () => {
  assert.match(payout, /if \(isDefiniteStripeRejection\(error\)\)/);
  assert.match(payout, /markReconciling\(admin, claim\.releaseId, error\)/);
  assert.doesNotMatch(recovery, /StripeConnectionError.*true/);
});

test('retry and simulated idempotency expiry recover by stable reference before create', () => {
  assert.match(payout, /transfer = await recoverTransfer\(stripe, claim\)/);
  assert.match(payout, /if \(!transfer\)[\s\S]*stripe\.transfers\.create/);
  assert.match(recovery, /transfer_group: claim\.transferReference/);
  assert.match(recovery, /payout_release_id === claim\.releaseId/);
  assert.match(recovery, /order_id === claim\.orderId/);
});

test('duplicate release and reconciliation finalization are idempotent', () => {
  assert.match(migration, /on conflict \(order_id\) do nothing/);
  assert.match(migration, /stripe_transfer_id = coalesce\(stripe_transfer_id, p_transfer_id\)/);
  assert.match(migration, /transferred_at = coalesce\(transferred_at, now\(\)\)/);
  assert.match(payout, /idempotencyKey:\s*`seller-payout:\$\{claim\.releaseId\}:v\$\{claim\.transferVersion\}`/);
});

test('only definite Stripe rejection can mark failed', () => {
  assert.match(payout, /if \(isDefiniteStripeRejection\(error\)\)[\s\S]*fail_seller_payout_v2/);
  assert.match(migration, /status = 'creating' and stripe_transfer_id is null/);
  const reconcilingFunction = migration.match(/create or replace function public\.mark_seller_payout_reconciling_v2[\s\S]*?\$\$;/)?.[0] ?? '';
  assert.doesNotMatch(reconcilingFunction, /status = 'failed'/);
});

test('scanner binds expected and scanned order on client and server', () => {
  assert.match(screen, /completePickup\(orderId, parsed\)/);
  assert.match(pickup, /p_expected_order_id: requireUuid\(body\.expectedOrderId\)/);
  assert.match(pickup, /p_scanned_order_id: requireUuid\(body\.scannedOrderId\)/);
  assert.match(migration, /p_expected_order_id <> p_scanned_order_id/);
  assert.match(migration, /message = 'QR_ORDER_MISMATCH'/);
});

test('bound pickup still checks seller buyer expiry replay and pickup-ready state', () => {
  assert.match(migration, /v_order\.seller_id <> p_seller_id/);
  assert.match(migration, /v_order\.buyer_id <> p_buyer_id/);
  assert.match(migration, /v_pickup\.used_at is not null or v_pickup\.expires_at <= now\(\)/);
  assert.match(migration, /v_order\.fulfillment_status <> 'pickup_ready'/);
  assert.match(migration, /where order_id = p_expected_order_id and buyer_id = p_buyer_id/);
});

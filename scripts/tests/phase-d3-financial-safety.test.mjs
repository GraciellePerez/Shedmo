import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202608060018_add_phase_d3_financial_safety.sql', 'utf8');
const cancel = readFileSync('supabase/functions/cancel-order/index.ts', 'utf8');
const refund = readFileSync('supabase/functions/process-order-refund/index.ts', 'utf8');
const reconcile = readFileSync('supabase/functions/reconcile-order-financials/index.ts', 'utf8');
const webhook = readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8');
const repository = readFileSync('src/features/checkout/checkoutRepository.ts', 'utf8');

test('backup PIN is cryptographic, hashed, six digit, shared-expiry, one-use, and rate limited', () => {
  assert.match(migration, /gen_random_bytes\(3\)/);
  assert.match(migration, /v_pin_value < 16000000/);
  assert.match(migration, /lpad\(\(v_pin_value % 1000000\)::text, 6, '0'\)/);
  assert.match(migration, /digest\(v_pin, 'sha256'\)/);
  assert.match(migration, /v_expires_at timestamptz := now\(\) \+ interval '15 minutes'/);
  assert.match(migration, /update public\.pickup_tokens set used_at = now\(\)[\s\S]*order_id = p_order_id and used_at is null/);
  assert.match(migration, /failed_pin_attempts >= 5/);
  assert.match(migration, /pin_locked_at/);
  assert.doesNotMatch(migration, /insert into public\.pickup_tokens[^;]*\bpin\b(?!_hash)/is);
});

test('PIN failures cannot mutate fulfillment or payout', () => {
  const pinFunction = migration.match(/create or replace function public\.consume_pickup_pin_v1[\s\S]*?\n\$\$;/)?.[0] ?? '';
  const invalidReturn = pinFunction.indexOf("return query select p_order_id, 'invalid'");
  const fulfillmentMutation = pinFunction.indexOf("fulfillment_status = 'pickup_confirmed'");
  assert.ok(invalidReturn > 0 && fulfillmentMutation > invalidReturn);
  assert.doesNotMatch(pinFunction.slice(0, invalidReturn), /seller_payout_releases|transfers\.create/);
});

test('shipping inspection is server timed for 48 hours and client cannot shorten it', () => {
  assert.match(migration, /v_delivered_at timestamptz := now\(\)/);
  assert.match(migration, /v_delivered_at \+ interval '48 hours'/);
  assert.match(migration, /fulfillment_status = 'inspection_window'/);
  assert.match(migration, /expire_order_inspections_v1/);
  assert.doesNotMatch(repository, /inspection_expires_at\s*:/);
});

test('seller risk delay and every financial hold gate payout', () => {
  assert.match(migration, /risk_tier = 'restricted'/);
  assert.match(migration, /make_interval\(days => v_account\.payout_delay_days\)/);
  assert.match(migration, /payout_not_before is null or v_order\.payout_not_before > now\(\)/);
  for (const gate of ['inspection_window', 'order_disputes', 'order_refunds', 'transfer_reversals']) {
    assert.match(migration, new RegExp(gate));
  }
  assert.match(migration, /v_account\.risk_tier = 'restricted'/);
});

test('D3 baseline formula remains trusted and client never supplies financial inputs', () => {
  assert.match(migration, /v_amount := v_order\.item_amount \+ v_order\.shipping_amount\s*- v_order\.marketplace_fee_amount - v_order\.reserve_withheld_amount/);
  assert.doesNotMatch(migration.match(/create or replace function public\.prepare_seller_payout_v2[\s\S]*?\n\$\$;/)?.[0] ?? '', /actual_processing_amount|estimated_processing_amount/);
  assert.doesNotMatch(repository, /body:\s*\{[^}]*(?:marketplace_fee_amount|actual_processing_amount|stripe_account_id)/s);
});

test('refunds and reversals persist stable trusted claims and enforce bounds', () => {
  assert.match(migration, /refund_reference text not null unique/);
  assert.match(migration, /reversal_reference text not null unique/);
  assert.match(migration, /status in \('pending','creating','reconciling','succeeded'\)/);
  assert.match(migration, /v_reserved \+ v_amount > v_payment\.amount/);
  assert.match(migration, /v_prior \+ v_amount > v_release\.amount/);
  assert.match(refund, /order-refund:\$\{claim\.refundId\}:v1/);
  assert.match(refund, /transfer-reversal:\$\{reversalClaim\.reversalId\}:v1/);
  assert.doesNotMatch(refund, /body\.(?:amount|transferId|paymentIntentId)/);
  assert.match(cancel, /prepare_order_refund_v1/);
});

test('disputes freeze payout and resolution remains service-only', () => {
  assert.match(migration, /update public\.orders set dispute_status = 'awaiting_seller_response', transfer_status = 'on_hold'/);
  assert.match(migration, /resolve_order_dispute_v1/);
  assert.match(migration, /revoke all on function public\.resolve_order_dispute_v1[^;]*authenticated/);
  assert.match(migration, /grant execute on function public\.resolve_order_dispute_v1[^;]*service_role/);
});

test('cancellation rejects unsafe fulfillment and only reactivates unpaid reserved inventory', () => {
  assert.match(migration, /'pickup_ready','pickup_confirmed','shipped','inspection_window','delivered','completed'/);
  assert.match(migration, /if not v_refund then[\s\S]*status = 'active'[\s\S]*status = 'reserved'/);
  assert.match(cancel, /parseObject\(request, \["orderId"\]\)/);
  assert.match(cancel, /p_amount: null/);
});

test('webhook adds only required D3 financial events and remains signature verified', () => {
  for (const event of ['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.refunded', 'refund.updated', 'transfer.reversed']) {
    assert.match(webhook, new RegExp(event.replaceAll('.', '\\.')));
  }
  assert.match(webhook, /constructEventAsync/);
  assert.match(webhook, /stripe_webhook_events/);
});

test('scheduled reconciliation is service authorized, bounded, and client independent', () => {
  assert.match(reconcile, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(reconcile, /limit\(50\)/);
  assert.match(reconcile, /p_limit: 100/);
  assert.match(reconcile, /recoverTransfer/);
  assert.match(reconcile, /recoverRefund/);
  assert.match(reconcile, /recoverReversal/);
  assert.match(reconcile, /seller-payout:\$\{claim\.releaseId\}:v\$\{claim\.transferVersion\}/);
  assert.match(reconcile, /order-refund:\$\{claim\.refundId\}:v1/);
  assert.match(reconcile, /transfer-reversal:\$\{claim\.reversalId\}:v1/);
});

test('D3 disables the superseded QR-only pickup proof issuer', () => {
  assert.match(migration, /revoke all on function public\.issue_pickup_token\(uuid\) from public, anon, authenticated/);
});

test('authenticated grants are read-only and financial identifiers are column-hidden', () => {
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]*to authenticated/i);
  assert.doesNotMatch(migration, /grant select \([^;]*(?:stripe_refund_id|stripe_transfer_id|stripe_reversal_id)[^;]*\) on[^;]*to authenticated/is);
  assert.doesNotMatch(migration, /grant[^;]*delete/i);
});

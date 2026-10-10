import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202608060016_add_phase_d2_fulfillment.sql', 'utf8');
const pickup = readFileSync('supabase/functions/complete-pickup/index.ts', 'utf8');
const payout = readFileSync('supabase/functions/release-seller-payout/index.ts', 'utf8');
const shipped = readFileSync('supabase/functions/mark-shipped/index.ts', 'utf8');

test('pickup proof is hashed, expires, and is consumed exactly once', () => {
  assert.match(migration, /token_hash text not null unique/i);
  assert.match(migration, /digest\(p_token, 'sha256'\)/i);
  assert.match(migration, /v_pickup\.used_at is not null or v_pickup\.expires_at <= now\(\)/i);
  assert.match(migration, /update public\.pickup_tokens set used_at = now\(\)/i);
  assert.match(migration, /unique index pickup_tokens_one_live_order_idx/i);
});

test('pickup rejects invalid QR identity, wrong seller, wrong buyer, and invalid state', () => {
  assert.match(pickup, /p_seller_id: user\.id/);
  assert.match(pickup, /p_buyer_id: requireUuid\(body\.buyerId\)/);
  assert.match(migration, /v_order\.seller_id <> p_seller_id/i);
  assert.match(migration, /v_order\.buyer_id <> p_buyer_id/i);
  assert.match(migration, /v_order\.fulfillment_status <> 'pickup_ready'/i);
  assert.match(migration, /Invalid pickup proof/i);
});

test('shipment cannot precede webhook-authoritative payment success', () => {
  assert.match(shipped, /p_seller_id: user\.id/);
  assert.match(migration, /v_order\.fulfillment_type <> 'shipping' or v_order\.payment_status <> 'succeeded'/i);
  assert.match(migration, /v_order\.fulfillment_status <> 'awaiting_shipment'/i);
  assert.doesNotMatch(shipped, /payment_status\s*:/i);
});

test('delivery requires a paid shipped order and authenticated buyer', () => {
  assert.match(migration, /v_order\.buyer_id <> p_buyer_id/i);
  assert.match(migration, /v_order\.fulfillment_status <> 'shipped'/i);
  assert.match(migration, /v_order\.payment_status <> 'succeeded'/i);
});

test('payout and transfer are protected from duplication', () => {
  assert.match(migration, /seller_payout_releases \(\s*order_id uuid primary key/i);
  assert.match(migration, /on conflict \(order_id\) do nothing/i);
  assert.match(payout, /idempotencyKey:\s*`seller-payout:\$\{claim\.releaseId\}:v\$\{claim\.transferVersion\}`/);
  assert.match(payout, /claim\.status === "transferred"/);
  assert.match(migration, /v_release\.status = 'transferred' and v_release\.stripe_transfer_id <> p_transfer_id/i);
});

test('transfer preserves separate charge architecture and never returns account identifiers', () => {
  assert.match(payout, /destination: claim\.destinationAccountId/);
  assert.match(payout, /source_transaction: claim\.sourceChargeId/);
  assert.doesNotMatch(payout, /return \{[^}]*seller_account_id/s);
  assert.doesNotMatch(payout, /application_fee|transfer_data/);
});

test('authenticated clients receive read-only fulfillment grants', () => {
  assert.match(migration, /grant select on table public\.order_shipments, public\.seller_payout_releases to authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]*to authenticated/i);
  assert.doesNotMatch(migration, /grant[^;]*delete/i);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202608060017_fix_phase_d2_release_reconciliation.sql', 'utf8');
const completePickup = readFileSync('supabase/functions/complete-pickup/index.ts', 'utf8');

const consumePickup = migration.match(
  /create or replace function public\.consume_pickup_token_bound_v2[\s\S]*?\n\$\$;/i,
)?.[0] ?? '';

const position = (pattern) => {
  const match = pattern.exec(consumePickup);
  assert.ok(match, `Missing expected pickup security clause: ${pattern}`);
  return match.index;
};

test('all pickup rejection guards execute before either persistent mutation', () => {
  const firstMutation = position(/update public\.pickup_tokens set used_at = now\(\)/i);
  const orderMutation = position(/update public\.orders\s+set fulfillment_status = 'pickup_confirmed'/i);

  const guards = [
    /auth\.role\(\) <> 'service_role'/i,
    /p_expected_order_id <> p_scanned_order_id/i,
    /v_order\.seller_id <> p_seller_id/i,
    /v_order\.buyer_id <> p_buyer_id/i,
    /v_order\.fulfillment_status <> 'pickup_ready'/i,
    /token_hash = encode\(extensions\.digest\(p_token, 'sha256'\), 'hex'\)/i,
    /v_pickup\.used_at is not null or v_pickup\.expires_at <= now\(\)/i,
  ];

  for (const guard of guards) assert.ok(position(guard) < firstMutation);
  assert.ok(firstMutation < orderMutation);
});

test('wrong-order rejection occurs before order lookup or proof lookup', () => {
  const mismatch = position(/p_expected_order_id <> p_scanned_order_id/i);
  assert.ok(mismatch < position(/select \* into v_order from public\.orders/i));
  assert.ok(mismatch < position(/select \* into v_pickup from public\.pickup_tokens/i));
});

test('replay and expiry share a pre-mutation rejection with a row lock', () => {
  assert.match(consumePickup, /select \* into v_pickup[\s\S]*for update;/i);
  const rejection = position(/v_pickup\.used_at is not null or v_pickup\.expires_at <= now\(\)/i);
  assert.ok(rejection < position(/update public\.pickup_tokens set used_at = now\(\)/i));
});

test('pickup rejection cannot create a payout release or Stripe transfer', () => {
  assert.doesNotMatch(consumePickup, /seller_payout_releases|stripe|transfer[s]?\.create/i);
  assert.doesNotMatch(completePickup, /release-seller-payout|transfers\.create|stripe/i);
});

test('successful pickup atomically consumes proof before making payout eligible', () => {
  assert.match(consumePickup, /language plpgsql security definer set search_path = ''/i);
  const consume = position(/update public\.pickup_tokens set used_at = now\(\)/i);
  const eligible = position(/transfer_status = 'eligible'/i);
  assert.ok(consume < eligible);
  assert.match(consumePickup, /payout_eligible_at = coalesce\(payout_eligible_at, now\(\)\)/i);
});


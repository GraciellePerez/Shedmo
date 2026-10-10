import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202608010015_add_phase_d1_checkout_backend_access.sql', 'utf8');
const checkout = readFileSync('supabase/functions/create-checkout-payment/index.ts', 'utf8');
const webhook = readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8');
const checkoutScreen = readFileSync('src/features/checkout/CheckoutScreen.tsx', 'utf8');
const repository = readFileSync('src/features/checkout/checkoutRepository.ts', 'utf8');

test('trusted grants are minimal and contain no delete', () => {
  assert.match(migration, /grant select, update on table public\.orders to service_role/i);
  assert.match(migration, /grant select, insert, update on table public\.payments to service_role/i);
  assert.match(migration, /grant select, update on table public\.listings to service_role/i);
  assert.doesNotMatch(migration, /grant[^;]*delete/i);
  assert.doesNotMatch(migration, /grant (?:select|insert|update)[^;]*to (?:anon|authenticated)\s*;/i);
});

test('checkout accepts identifiers plus a strictly validated destination and uses order-version idempotency', () => {
  assert.match(checkout, /\["listingId", "fulfillmentType", "clientCheckoutKey", "destination"\]/);
  assert.match(checkout, /row\.fulfillmentType === "shipping" && !isDestination\(row\.destination\)/);
  assert.match(checkout, /checkout-payment:\$\{order\.id\}:\$\{PAYMENT_ATTEMPT_VERSION\}/);
  assert.match(checkout, /payment_method_types: \["card"\]/);
  assert.doesNotMatch(checkout, /application_fee|transfer_data/);
});

test('checkout exposes only a sanitized reservation SQLSTATE for runtime diagnosis', () => {
  assert.match(checkout, /RESERVATION_DB_\$\{reservationCode \|\| "UNKNOWN"\}/);
  assert.match(checkout, /\^RESERVATION_DB_\[A-Z0-9_\]/);
  assert.match(checkout, /column reference "\(\[a-z_\]\{1,30\}\)" is ambiguous/);
  assert.doesNotMatch(checkout, /reservationError\.details/);
  assert.match(repository, /\^\[A-Z0-9_\]\{1,50\}\$/);
});

test('webhook owns paid state and handles the minimal PaymentIntent events', () => {
  for (const event of ['processing', 'succeeded', 'payment_failed', 'canceled']) {
    assert.match(webhook, new RegExp(`payment_intent\\.${event}`));
  }
  assert.match(webhook, /apply_checkout_payment_event/);
  assert.match(migration, /set status = 'sold'/);
  assert.match(migration, /then 'pickup_scheduled'/);
  assert.match(migration, /else 'awaiting_shipment'/);
});

test('reservation and success guards remain explicit', () => {
  assert.match(checkout, /listing\.status !== "reserved"/);
  assert.match(checkout, /CHECKOUT_EXPIRED/);
  assert.match(checkout, /order\.payment_status === "succeeded"/);
  assert.match(migration, /v_payment\.status = 'succeeded' and p_status <> 'succeeded'/);
});

test('mobile checkout key is a UUID v4 created once per screen instance', () => {
  assert.match(checkoutScreen, /xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx/);
  assert.match(checkoutScreen, /useState\(createCheckoutKey\)/);
  assert.match(checkoutScreen, /initializeCheckout\([\s\S]*listingId, method, clientCheckoutKey, method === 'shipping' \? destination : undefined/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202609070040_separate_listing_status_from_local_sale_confirmation.sql', 'utf8');
const screen = readFileSync('src/features/localSales/LocalSaleScreen.tsx', 'utf8');
const product = readFileSync('src/features/listings/ProductDetailsScreen.tsx', 'utf8');
const conversation = readFileSync('src/features/messaging/ConversationScreen.tsx', 'utf8');

const functionBody = (name) => migration.match(
  new RegExp(`create or replace function public\\.${name}[\\s\\S]*?(?=create or replace function|revoke all on function public\\.mark_local_listing_disposition_v2)`, 'i'),
)?.[0] ?? '';

test('starting a Shedmo sale marks the listing sold before buyer confirmation', () => {
  const start = functionBody('start_direct_local_sale_v1');
  assert.match(start, /update public\.listings set status = 'sold'/);
  assert.match(start, /'pending_buyer_confirmation'/);
  assert.ok(start.indexOf("status = 'sold'") < start.indexOf("'pending_buyer_confirmation'"));
  assert.match(start, /conversation_id = p_conversation_id/);
  assert.match(start, /v_conversation\.buyer_id = v_actor/);
  assert.match(start, /exists \(select 1 from public\.messages/);
});

test('buyer response changes confirmation state without controlling listing availability', () => {
  const respond = functionBody('respond_direct_local_sale_v1');
  assert.match(respond, /status = 'confirmed'/);
  assert.match(respond, /status = 'rejected'/);
  assert.doesNotMatch(respond, /update public\.listings/);
  assert.match(respond, /v_sale\.status = 'confirmed' and p_confirm/);
  assert.match(respond, /v_sale\.status = 'rejected' and not p_confirm/);
});

test('seller can mark sold elsewhere or archive without creating a confirmed sale', () => {
  const disposition = functionBody('mark_local_listing_disposition_v2');
  assert.match(disposition, /p_disposition not in \('sold_elsewhere', 'unavailable'\)/);
  assert.match(disposition, /sold_elsewhere' then 'sold' else 'archived'/);
  assert.doesNotMatch(disposition, /insert into public\.local_sale_confirmations/);
});

test('verified seller sales count only completed orders and confirmed local sales', () => {
  const profile = functionBody('get_public_seller_profile_v2');
  assert.match(profile, /fulfillment_status = 'completed'/);
  assert.match(profile, /local_sale_confirmations s where s\.seller_id = p\.id and s\.status = 'confirmed'/);
});

test('seller and buyer screens use role-specific local-only wording', () => {
  for (const copy of [
    'Sold on Shedmo', 'Sold somewhere else', 'No longer available',
    'Confirm purchase', 'Yes, I bought this', "No, I didn&apos;t",
    'Waiting for buyer confirmation',
  ]) assert.match(screen, new RegExp(copy));
  assert.doesNotMatch(screen, /Protected Checkout/);
  assert.match(product, /Edit Listing/);
  assert.match(product, /Mark as Sold/);
  assert.match(product, /!isOwner \? <View style=\{styles\.messageWrap\}>/);
  assert.match(conversation, /Shedmo does not process payments for local sales/);
  assert.doesNotMatch(conversation, /Protected Checkout/);
});

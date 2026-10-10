import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { listingGalleryHeight } from '../../src/features/listings/galleryLayout.ts';

const details = readFileSync('src/features/listings/ProductDetailsScreen.tsx', 'utf8');
const orders = readFileSync('src/features/checkout/checkoutRepository.ts', 'utf8');
const card = readFileSync('src/features/account/components/OrderCard.tsx', 'utf8');
const fulfillment = readFileSync('src/features/fulfillment/FulfillmentOrderScreen.tsx', 'utf8');
const policy = readFileSync('supabase/migrations/202608150033_allow_order_participants_read_listing_history.sql', 'utf8');

test('listing gallery is viewport-responsive and substantially taller on a typical phone', () => {
  assert.ok(Math.abs(listingGalleryHeight(390, 844) - 460.2) < 0.01);
  assert.ok(Math.abs(listingGalleryHeight(320, 568) - 352.16) < 0.01);
  assert.equal(listingGalleryHeight(700, 1200), 560);
});

test('listing photos preserve aspect ratio with safe fallback and multi-photo indicators', () => {
  assert.match(details, /contentFit="contain"/);
  assert.match(details, /galleryBackdrop/);
  assert.match(details, /onError=/);
  assert.match(details, /setFailedImages/);
  assert.match(details, /Photo unavailable/);
  assert.match(details, /images\.length > 1 \? <View style=\{styles\.photoCount\}/);
  assert.match(details, /horizontal/);
  assert.match(details, /pagingEnabled/);
});

test('purchase history resolves immutable image snapshots and falls back safely', () => {
  assert.match(orders, /listing_image_snapshot/);
  assert.match(orders, /createSignedUrls\(storagePaths, 60 \* 60\)/);
  assert.match(orders, /listing_image_url:/);
  assert.match(card, /order\.listing_image_url/);
  assert.match(card, /styles\.placeholder/);
});

test('order details link to the original listing while retaining snapshot context', () => {
  assert.match(fulfillment, /order\.listing_title_snapshot/);
  assert.match(fulfillment, /order\.listing_image_url/);
  assert.match(fulfillment, /View Original Listing/);
  assert.match(fulfillment, /pathname: '\/listings\/\[id\]'/);
  assert.match(fulfillment, /id: order\.listing_id/);
});

test('historical listing access is read-only and limited to exact order participants', () => {
  assert.match(policy, /on public\.listings for select to authenticated/);
  assert.match(policy, /on public\.listing_images for select to authenticated/);
  assert.match(policy, /on storage\.objects for select to authenticated/);
  assert.match(policy, /auth\.uid\(\) in \(o\.buyer_id, o\.seller_id\)/g);
  assert.doesNotMatch(policy, /for (insert|update|delete)|service_role/i);
});

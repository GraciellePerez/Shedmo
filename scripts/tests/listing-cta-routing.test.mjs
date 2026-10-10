import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const product = readFileSync('src/features/listings/ProductDetailsScreen.tsx', 'utf8');
const checkout = readFileSync('src/features/checkout/CheckoutScreen.tsx', 'utf8');
const route = readFileSync('src/app/checkout/[listingId].tsx', 'utf8');
const phaseD1 = readFileSync('supabase/migrations/202607310013_add_order_payment_foundation.sql', 'utf8');

test('fulfillment copy describes local direct payment and protected shipping', () => {
  for (const copy of [
    'Local pickup only',
    'Message the seller to arrange a meetup and pay directly after inspecting the item.',
    'Shipping available',
    'Shipped purchases use Shedmo Protected Checkout.',
    'Local pickup — Arrange with seller and pay directly',
    'Shipping — Pay through Shedmo Protected Checkout',
  ]) assert.match(product, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Buy Shipped requests shipping and cannot fall back to pickup when stale', () => {
  assert.match(product, /params: \{ listingId, fulfillment: 'shipping' \}/);
  assert.match(route, /fulfillment === 'shipping' \? 'shipping' : undefined/);
  assert.match(checkout, /requestedFulfillment && !methods\.includes\(requestedFulfillment\)/);
  assert.match(checkout, /Shipping is no longer available for this listing/);
  assert.match(checkout, /requestedFulfillment \?\? \(methods\.length === 1 \? methods\[0\] : null\)/);
});

test('server rejects a protected shipping order when shipping is unavailable', () => {
  assert.match(phaseD1, /p_fulfillment_type = 'shipping' and not v_listing\.shipping_available/);
  assert.match(phaseD1, /Shipping is not available/);
});

test('generic checkout still retains the existing optional protected pickup path', () => {
  assert.match(checkout, /if \(listing\?\.pickup\) methods\.push\('pickup'\)/);
  assert.match(checkout, /available\.length > 1 && !requestedFulfillment/);
});

test('authentication and conversation routing remain delegated to the existing messaging flow', () => {
  assert.match(product, /const \{ user \} = useAuthStore\(\)/);
  assert.match(product, /await getOrCreateConversation\(listing\)/);
  assert.match(product, /pathname: '\/conversations\/\[id\]'/);
});

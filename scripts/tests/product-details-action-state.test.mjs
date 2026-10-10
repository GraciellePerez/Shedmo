import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProductDetailsActionState,
  isLatestListingRequest,
} from '../../src/features/listings/productDetailsActionState.ts';

const resolve = (overrides = {}) => getProductDetailsActionState({
  hasPickup: true,
  hasShipping: true,
  isOwner: false,
  offerSupported: true,
  publicShippingEnabled: true,
  sellerCheckoutEligible: null,
  status: 'active',
  ...overrides,
});

test('sold listing wins when seller is eligible', () => {
  assert.deepEqual(resolve({ status: 'sold', sellerCheckoutEligible: true }), {
    checkoutEnabled: false,
    checkoutLabel: 'Sold',
    evaluateSellerEligibility: false,
    showBuyerActions: false,
    showLocalMessage: false,
    showShippingCheckout: false,
    showMakeOffer: false,
  });
});

test('sold listing wins when seller is ineligible', () => {
  assert.equal(resolve({ status: 'sold', sellerCheckoutEligible: false }).checkoutLabel, 'Sold');
});

test('reserved listing blocks purchase actions', () => {
  const state = resolve({ status: 'reserved', sellerCheckoutEligible: true });
  assert.equal(state.checkoutLabel, 'Reserved');
  assert.equal(state.checkoutEnabled, false);
  assert.equal(state.showMakeOffer, false);
});

test('active listing with eligible seller enables checkout and supported offers', () => {
  const state = resolve({ sellerCheckoutEligible: true });
  assert.equal(state.checkoutLabel, 'Buy Shipped');
  assert.equal(state.checkoutEnabled, true);
  assert.equal(state.showMakeOffer, true);
});

test('local-only listing shows direct messaging without a protected shipping CTA', () => {
  const state = resolve({ hasPickup: true, hasShipping: false, sellerCheckoutEligible: true });
  assert.equal(state.showBuyerActions, true);
  assert.equal(state.showLocalMessage, true);
  assert.equal(state.showShippingCheckout, false);
  assert.equal(state.evaluateSellerEligibility, false);
});

test('shipping-only listing shows only the protected shipping CTA', () => {
  const state = resolve({ hasPickup: false, hasShipping: true, sellerCheckoutEligible: true });
  assert.equal(state.showLocalMessage, false);
  assert.equal(state.showShippingCheckout, true);
  assert.equal(state.checkoutEnabled, true);
});

test('non-purchasable and self-owned listings show no buyer actions', () => {
  assert.equal(resolve({ status: 'sold', sellerCheckoutEligible: true }).showBuyerActions, false);
  assert.equal(resolve({ status: 'reserved', sellerCheckoutEligible: true }).showBuyerActions, false);
  assert.equal(resolve({ status: 'pending_local_confirmation', sellerCheckoutEligible: true }).showBuyerActions, false);
  assert.equal(resolve({ isOwner: true, sellerCheckoutEligible: true }).showBuyerActions, false);
});

test('active listing with incomplete seller setup shows setup state', () => {
  const state = resolve({ sellerCheckoutEligible: false });
  assert.equal(state.checkoutLabel, 'Seller is still setting up payments');
  assert.equal(state.checkoutEnabled, false);
  assert.equal(state.evaluateSellerEligibility, true);
});

test('sold refresh cannot be overwritten by an older active response', () => {
  const staleActiveRequest = 1;
  const soldRefreshRequest = 2;
  let state = null;
  if (isLatestListingRequest(soldRefreshRequest, soldRefreshRequest)) {
    state = resolve({ status: 'sold', sellerCheckoutEligible: false });
  }
  if (isLatestListingRequest(staleActiveRequest, soldRefreshRequest)) {
    state = resolve({ status: 'active', sellerCheckoutEligible: true });
  }
  assert.equal(state.checkoutLabel, 'Sold');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PROTECTED_CHECKOUT_ENABLED,
  PUBLIC_SHIPPING_ENABLED,
} from '../../src/config/launchFeatures.ts';
import { getProductDetailsActionState } from '../../src/features/listings/productDetailsActionState.ts';

const read = (path) => readFileSync(path, 'utf8');
const sell = read('src/features/sell/SellScreen.tsx');
const listingRepository = read('src/features/listings/services/listingRepository.ts');
const product = read('src/features/listings/ProductDetailsScreen.tsx');
const checkoutScreen = read('src/features/checkout/CheckoutScreen.tsx');
const checkoutFunction = read('supabase/functions/create-checkout-payment/index.ts');
const launchServer = read('supabase/functions/_shared/launchFeatures.ts');
const conversation = read('src/features/messaging/ConversationScreen.tsx');
const localSale = read('src/features/localSales/localSaleRepository.ts');
const localReview = read('src/features/localSales/LocalSaleReviewScreen.tsx');
const listingCard = read('src/components/ListingCard.tsx');
const home = read('src/features/home/HomeScreen.tsx');
const editProfile = read('src/features/profile/EditProfileScreen.tsx');
const settings = read('src/features/account/SettingsScreen.tsx');
const settingDetails = read('src/features/account/SettingDetailScreen.tsx');
const help = read('src/features/account/HelpSupportScreen.tsx');
const onboarding = read('src/features/auth/OnboardingScreen.tsx');
const authCallback = read('src/app/auth/callback.tsx');
const feedback = read('src/features/feedback/BetaFeedbackScreen.tsx');
const sellerProfile = read('src/features/profile/SellerProfileScreen.tsx');

test('public launch flags default to local-only and Protected Checkout off', () => {
  assert.equal(PUBLIC_SHIPPING_ENABLED, false);
  assert.equal(PROTECTED_CHECKOUT_ENABLED, false);
});

test('shipping and Protected Checkout actions are hidden when launch flags are disabled', () => {
  const state = getProductDetailsActionState({
    hasPickup: true,
    hasShipping: true,
    isOwner: false,
    offerSupported: true,
    publicShippingEnabled: false,
    sellerCheckoutEligible: true,
    status: 'active',
  });
  assert.equal(state.showLocalMessage, true);
  assert.equal(state.showShippingCheckout, false);
  assert.equal(state.evaluateSellerEligibility, false);
  assert.match(product, /PUBLIC_SHIPPING_ENABLED/);
  assert.doesNotMatch(sell, /DeliveryToggle|Local Pickup|Nationwide Shipping|Shipping price|Protected Checkout|View My Listings/);
  assert.match(sell, /3: 'Price & Location'/);
  assert.match(sell, /<Text style=\{styles\.cardTitle\}>Item Location<\/Text>/);
  assert.match(sell, />View Listing</);
  assert.match(sell, />Sell Another Item</);
  assert.match(sell, /pathname: '\/listings\/\[id\]'[\s\S]*params: \{ id: publishedId \}/);
  assert.match(sell, /const sellAnother = \(\) => \{\s*form\.resetDraft\(\);\s*setPublishedId\(null\);\s*\}/);
  assert.match(listingCard, /PUBLIC_SHIPPING_ENABLED && listing\.shipping/);
});

test('direct checkout navigation and server checkout calls fail closed', () => {
  assert.match(checkoutScreen, /if \(!PROTECTED_CHECKOUT_ENABLED\)/);
  assert.match(checkoutScreen, /Public V1 is local pickup only/);
  const gate = checkoutFunction.indexOf('if (!protectedCheckoutEnabled())');
  const reservation = checkoutFunction.indexOf('reserve_listing_for_checkout_v2');
  assert.ok(gate > 0 && reservation > gate);
  assert.match(checkoutFunction, /FEATURE_DISABLED/);
  assert.match(launchServer, /publicShippingEnabled\(\) && enabled\("ENABLE_PROTECTED_CHECKOUT"\)/);
});

test('new listings are normalized to local pickup even if stale shipping state reaches the repository', () => {
  assert.match(listingRepository, /pickupAvailable = PUBLIC_SHIPPING_ENABLED \? draft\.pickup : true/);
  assert.match(listingRepository, /shippingAvailable = PUBLIC_SHIPPING_ENABLED \? draft\.shipping : false/);
  assert.match(listingRepository, /shipping_price: shippingAvailable/);
  assert.match(listingRepository, /p_fulfillment: PUBLIC_SHIPPING_ENABLED \? filters\.fulfillment : 'pickup'/);
});

test('public V1 hides unfinished promotion and exposes functional profile-photo controls', () => {
  assert.doesNotMatch(home, /AI identifies tools|Coming Soon|NEW FEATURE/);
  assert.doesNotMatch(editProfile, /Profile photos coming later|name="camera"/);
  assert.match(editProfile, /Change Photo|Add Photo/);
  assert.match(editProfile, /Alert\.alert\('Profile updated', 'Your changes have been saved\.'/);
  assert.doesNotMatch(editProfile, /public Supabase profile/);
});

test('public V1 does not present an offer preference sellers cannot control', () => {
  assert.doesNotMatch(listingCard, /Offer OK/);
  assert.doesNotMatch(product, /Offers Welcome/);
});

test('public V1 settings expose only functional navigation and public release copy', () => {
  for (const entry of ["label: 'Addresses'", "label: 'Privacy'", "label: 'Appearance'"]) {
    assert.doesNotMatch(settings, new RegExp(entry));
  }
  assert.match(settingDetails, /addresses:/);
  assert.match(settingDetails, /privacy:/);
  assert.match(settingDetails, /appearance:/);
  for (const screen of [settings, onboarding, authCallback, feedback]) {
    assert.doesNotMatch(screen, /PRIVATE BETA|Private Beta|private beta|STRIPE TEST MODE|Stripe test mode|Development environment|development environment/);
  }
  assert.doesNotMatch(settings, /\?\? 'development'/);
});

test('public V1 help is local-only and does not expose fake support controls', () => {
  assert.match(help, /arrange a local pickup/);
  assert.match(help, /Inspect the item before paying the seller directly/);
  assert.doesNotMatch(help, /Buy Now|prototype|Contact Support|Report a Problem|saved locally/);
  assert.doesNotMatch(sellerProfile, /Report Seller|local prototype/);
});

test('local messaging, mutual sale confirmation, and transaction-gated reviews remain wired', () => {
  assert.match(product, /await getOrCreateConversation\(listing\)/);
  assert.match(product, /Arrange local pickup/);
  assert.match(conversation, /pathname: '\/local-sale\/\[listingId\]'/);
  assert.match(localSale, /respond_direct_local_sale/);
  assert.match(localSale, /confirm/);
  assert.match(localReview, /submit_local_sale_review_v1/);
});

test('shipping mutation and EasyPost endpoints share the default-off server boundary', () => {
  for (const path of [
    'supabase/functions/mark-shipped/index.ts',
    'supabase/functions/submit-shipment-tracking/index.ts',
    'supabase/functions/mark-delivered/index.ts',
    'supabase/functions/accept-delivery/index.ts',
  ]) assert.match(read(path), /requirePublicShipping\(\)/);
  assert.match(read('supabase/functions/easypost-webhook/index.ts'), /if \(!publicShippingEnabled\(\)\)/);
});

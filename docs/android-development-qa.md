# Shedmo Android Development QA

Date: 2026-08-15

Target: Android emulator, development Supabase project `YOUR_PROJECT_REF`, Stripe test mode. Package `com.gracielleperez.shedmo`; scheme `shedmo`.

The linked EAS project keeps its non-user-facing remote slug `ProjectMarketplaceMobile` because the stable project ID is already provisioned under that slug and EAS rejects a mismatched local slug. Creating a replacement project would lose prepared environments and history. App display branding and native identities are Shedmo.

## Build and launch

The identity and custom scheme changed, so the old installed development client cannot be reused. With an emulator online, generate and install the new native development build:

```powershell
$env:ANDROID_USER_HOME=Join-Path $env:TEMP 'shedmo-android'
npx expo run:android
```

If an ignored `android/` directory was generated before the identity change, regenerate it once before building:

```powershell
npx expo prebuild --platform android --clean
npx expo run:android
```

For later launches, use the repository helper, which selects a free Metro port, configures ADB reverse, and opens the Shedmo development client:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-android-dev.ps1
```

To intentionally reset only Shedmo's emulator app data:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-android-dev.ps1 -ClearAppData
```

Never clear Supabase tables or development test listings as part of emulator reset.

## Automated smoke result (2026-08-15)

- PASS: a clean native project generated namespace/application ID `com.gracielleperez.shedmo` and the `shedmo` intent scheme.
- PASS: Gradle `app:assembleDebug` completed and the APK installed on `emulator-5554`.
- PASS: the development client connected to Metro on port 8082 and opened the real app.
- PASS: the launch screen visibly showed Shedmo, the expected tool-marketplace copy, and `Private Beta · Development environment · Stripe test mode`.
- PASS: the UI hierarchy belonged to `com.gracielleperez.shedmo`; no fatal `AndroidRuntime` or `ReactNativeJS` log entry was returned during the smoke window.
- FIXED: the first build reused a stale ignored native directory and therefore built the old package/scheme. Clean prebuild regeneration corrected it. This did not change Supabase data, Stripe configuration, or committed native source.
- NOT RUN: the manual account, listing, messaging, transaction, review, permissions, admin, accessibility, and device-size scenarios below still require interactive QA.

## Launch and navigation

- [ ] Cold launch shows Shedmo Private Beta / development / Stripe test-mode labeling without a blank screen.
- [ ] Warm launch restores the expected screen and session.
- [ ] All five tabs, Android back, screen transitions, modals, and dialogs behave correctly.
- [ ] Keyboard does not obscure auth, listing, messaging, checkout, dispute, review, settings, or admin inputs.
- [ ] Background/foreground and rotation-lock behavior are stable.

## Authentication and links

- [ ] Signup, duplicate username/email handling, verification instructions, valid verification callback, and login work.
- [ ] Invalid login is actionable and does not create a session.
- [ ] Logout clears protected UI and cold session restoration works when logged in.
- [ ] Forgot password and `shedmo://reset-password` establish only a recovery session.
- [ ] `shedmo://auth/callback` establishes normal signup verification without opening Reset Password.
- [ ] Logged-out protected screens and payout callbacks route to sign-in.
- [ ] Connect return and refresh callbacks open only their intended payout screens.
- [ ] Bare, malformed, wrong-scheme, and cross-purpose auth links fail safely.

Development Supabase Authentication > URL Configuration must manually allow:

- `shedmo://auth/callback`
- `shedmo://reset-password`

Do not delete old redirects until legacy development clients are no longer needed.

## Listings and discovery

- [ ] Browse pagination, search, filters, and every category render real development rows.
- [ ] Listing details handle one photo, multiple photos, missing/failing images, long title/description, low/high price, and seller ratings.
- [ ] Active, reserved, pending-local-confirmation, and sold states expose only valid actions.
- [ ] Favorite/unfavorite persists and Saved Items reflects changes.
- [ ] Create a disposable listing; select multiple gallery photos, preview, reorder/remove if offered, publish, edit, and delete if supported.
- [ ] Exercise pickup-only, shipping-only, and combined fulfillment listings.
- [ ] Deny camera/photo/location permission, retry, and verify Settings guidance.

Existing development fixtures are preserved. There is no safe listing seeder. If coverage is missing, create disposable listings through the normal UI for: drill, impact driver, saw, toolbox, generator, pressure washer, lawn equipment, socket set, hand tools, compressor, ladder, and outdoor power equipment. Include one/many photos, long content, price extremes, multiple sellers, messages, favorites, and every lifecycle/fulfillment state.

## Messaging

- [ ] Start a listing-linked conversation as a buyer.
- [ ] Send, receive, order, and render messages correctly.
- [ ] Keyboard/composer remains visible and unread state updates if supported.
- [ ] Seller eligible-buyer selection contains only actual conversation participants.

## Transactions

- [ ] Free local direct sale creates no Stripe order, fee, payout, refund, or dispute row; seller marks sold, buyer confirms, and both may review.
- [ ] Local Protected Checkout opens Stripe PaymentSheet with a test card, reconciles processing fee, completes QR/PIN pickup, and reaches test payout/review state.
- [ ] Shipping-only listing omits direct sale; test checkout, shipment, delivery/inspection, payout, and reviews complete.
- [ ] Direct/protected inventory race protections prevent double sale.
- [ ] Cancellation and refund paths restore inventory only when safe and remain idempotent.
- [ ] Buyer dispute freezes payout, seller response works, admin resolution is authorized/audited, and Stripe test refund reconciles.

## Reviews

- [ ] Buyer and seller protected-order reviews are mutually eligible only after completion.
- [ ] Confirmed local-sale reviews are labeled correctly and require mutual confirmation.
- [ ] Duplicate reviews and reviews by unrelated users are rejected.

## Profile, settings, notifications, and location

- [ ] Seller profile, edit profile, ratings, listing counts, and share sheet show Shedmo branding.
- [ ] Location allow/deny/manual city-state and distance behavior work.
- [ ] Notification permission allow/deny, token registration, foreground/background receipt, and tap routing work where the emulator supports them.
- [ ] Privacy, safety, fees, About, feedback, and logout screens render without old branding.

## Admin and security

- [ ] Normal buyer has no Admin & Moderation entry; direct admin navigation and function calls are rejected.
- [ ] Development admin loads reports, disputes, Local Sales, users, listings, financial monitoring, analytics, feedback, and audit queues.
- [ ] Malformed links do not open protected screens; signup and recovery callbacks cannot cross-route.
- [ ] Unauthorized protected RPC/Edge Function calls fail without state changes.
- [ ] Stripe rejects any non-`pk_test_` publishable key; Google Pay remains disabled.

## Visual and accessibility QA

- [ ] No Project Marketplace/ProjectMarketplaceMobile branding appears.
- [ ] Check text clipping, overlap, image scaling, buttons, bottom navigation, spinners, empty/error states, and keyboard resizing.
- [ ] Repeat core screens on a small emulator size and with large system font/display scaling.
- [ ] Verify contrast, touch targets, accessibility labels, and screen-reader order on primary actions.

## External follow-up

The development Stripe Connect redirect Edge Functions must be redeployed from their updated source before testing the `shedmo:///settings/payouts/return` and `/refresh` callbacks. No production function or Stripe setting should be changed.

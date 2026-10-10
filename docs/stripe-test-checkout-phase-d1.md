# Phase D1 Stripe test checkout

Phase D1 uses the existing authenticated reservation RPC to atomically reserve one active listing and snapshot its server-calculated price. The authenticated `create-checkout-payment` Edge Function creates or retrieves one platform PaymentIntent. The signed `stripe-webhook` is the only component that confirms payment, marks the listing sold, and advances fulfillment to `pickup_scheduled` or `awaiting_shipment`.

This is Stripe test mode only. It does not create transfers, payouts, refunds, disputes, taxes, wallet payments, saved payment methods, offers, tracking, or pickup confirmation.

## Manual setup

1. Add the Stripe test publishable key to the local Expo environment (do not put it in chat):

   ```text
   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```

2. No new server secret is introduced. Confirm the already-deployed functions have `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SIGNING_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

3. Apply `supabase/migrations/202608010015_add_phase_d1_checkout_backend_access.sql` through the normal migration workflow.

4. Deploy only the new checkout function and the changed webhook:

   ```powershell
   npx supabase functions deploy create-checkout-payment
   npx supabase functions deploy stripe-webhook --no-verify-jwt
   ```

5. In Stripe Workbench/webhook settings, keep the existing endpoint and subscribe it to:

   - `account.updated`
   - `account.application.deauthorized`
   - `payment_intent.processing`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`

6. Because Stripe React Native contains native code, rebuild the Android development client, then restart Metro:

   ```powershell
   npx expo run:android
   npx expo start --dev-client --clear
   ```

## Test cases

Use Stripe's current official test cards in test mode for success, decline, and authentication-required behavior. Also verify PaymentSheet cancellation, duplicate taps, duplicate function calls with the same checkout key, webhook replay, an already reserved listing, expiration, seller restriction, self-purchase, client closure after confirmation, wrong webhook amount/currency, and a second buyer attempting the same listing.

The app never treats PaymentSheet completion as authoritative. It waits for the verified webhook and shows a bounded confirmation state. A delayed confirmation remains visible from Purchases after the app is reopened.

Notifications were intentionally not expanded in D1: the current notification table has a narrow message/favorite type constraint, and adding order notifications would require a broader cross-feature migration. That belongs in the next order-lifecycle phase.

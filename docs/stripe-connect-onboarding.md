# Stripe Connect Express onboarding (test mode)

This phase implements seller onboarding only. It does not create orders, PaymentIntents, charges, transfers, refunds, disputes, or tax calculations.

## Stripe Dashboard setup

1. Open the Stripe Dashboard in **test mode**.
2. Activate/configure Connect for the platform and choose Stripe-hosted **Express** onboarding.
3. Complete platform branding and the business/profile information Stripe requires before creating connected accounts.
4. Obtain a test secret key (`sk_test_...`) from Developers > API keys. Store it outside this repository; never put it in an `EXPO_PUBLIC_` variable.
5. After the functions have been reviewed and deployed, create a test webhook endpoint at:

   `https://<PROJECT_REF>.supabase.co/functions/v1/stripe-webhook`

6. Subscribe only to `account.updated` and `account.application.deauthorized` for this phase.
7. Reveal the endpoint signing secret (`whsec_...`) and store it with Supabase secrets. Do not paste it into source code or chat.

The Account Link return route refreshes the account from Stripe. Returning to the app is not proof that onboarding is complete.

Stripe receives HTTPS callback URLs hosted by two public, data-free Supabase Edge Functions. Each function performs one fixed redirect into the app and cannot accept or forward a caller-supplied destination or query parameters:

- `connect-onboarding-return-redirect` redirects to `shedmo:///settings/payouts/return`, where the app refreshes account status from Stripe.
- `connect-onboarding-refresh-redirect` redirects to `shedmo:///settings/payouts/refresh`, where the app calls the authenticated `connect-onboarding-link` function for a fresh one-time Account Link.

The redirect functions are public because Stripe and browsers do not send a Supabase JWT when following callback URLs. They read no user data, cookies, JWTs, Supabase data, Stripe data, or secrets and perform no backend operation beyond their fixed redirects.

## Supabase secrets

Supabase-hosted Edge Functions provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically. They are server-only and must never be copied into the Expo app. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SIGNING_SECRET` must be configured as Edge Function secrets.

Create a secure file outside the repository, for example `supabase/functions/.env.local`:

```dotenv
STRIPE_SECRET_KEY=sk_test_REPLACE_SECURELY
STRIPE_WEBHOOK_SIGNING_SECRET=whsec_REPLACE_AFTER_WEBHOOK_SETUP
CONNECT_ONBOARDING_RETURN_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/connect-onboarding-return-redirect
CONNECT_ONBOARDING_REFRESH_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/connect-onboarding-refresh-redirect
```

Then authenticate, link the project, and upload the secrets:

```powershell
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase secrets set --project-ref <PROJECT_REF> --env-file supabase/functions/.env.local
npx supabase secrets list --project-ref <PROJECT_REF>
```

To update only the callback secrets without changing the Stripe secrets, run:

```powershell
npx supabase secrets set --project-ref YOUR_PROJECT_REF CONNECT_ONBOARDING_RETURN_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/connect-onboarding-return-redirect CONNECT_ONBOARDING_REFRESH_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/connect-onboarding-refresh-redirect
```

Do not commit the secure environment file. For self-hosted or local Supabase only, add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the external environment file supplied to the local function runtime.

## Local function testing

This repository does not currently include a complete local Supabase stack configuration, and Docker/local function serving was not started during implementation. Once the Supabase CLI and Docker are available:

```powershell
npx supabase start
npx supabase functions serve connect-account-create-or-get --env-file supabase/functions/.env.local
npx supabase functions serve connect-onboarding-link --env-file supabase/functions/.env.local
npx supabase functions serve connect-account-refresh --env-file supabase/functions/.env.local
npx supabase functions serve connect-onboarding-return-redirect --no-verify-jwt
npx supabase functions serve connect-onboarding-refresh-redirect --no-verify-jwt
npx supabase functions serve stripe-webhook --no-verify-jwt --env-file supabase/functions/.env.local
```

Forward only the onboarding events with the Stripe CLI:

```powershell
stripe login
stripe listen --events account.updated,account.application.deauthorized --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
```

Use the signing secret printed by `stripe listen` in the external local environment file. Exercise real test-mode hosted onboarding to generate an `account.updated` event; do not use payment-event fixtures for this phase.

## Deployment commands (review first; do not run automatically)

```powershell
npx supabase functions deploy connect-account-create-or-get --project-ref <PROJECT_REF>
npx supabase functions deploy connect-onboarding-link --project-ref <PROJECT_REF>
npx supabase functions deploy connect-account-refresh --project-ref <PROJECT_REF>
npx supabase functions deploy connect-onboarding-return-redirect --project-ref <PROJECT_REF> --no-verify-jwt
npx supabase functions deploy connect-onboarding-refresh-redirect --project-ref <PROJECT_REF> --no-verify-jwt
npx supabase functions deploy stripe-webhook --project-ref <PROJECT_REF> --no-verify-jwt
```

The checked-in `supabase/config.toml` disables Supabase JWT verification for the two fixed redirect functions and for `stripe-webhook`. Stripe authenticates the webhook with its raw-body signature. The three seller functions retain platform JWT verification and independently resolve the user from the bearer token.

## Required test matrix

- Authenticated seller creates exactly one Express account, including rapid repeated requests and retry after a partial database failure.
- Another seller cannot retrieve that account, status, or onboarding link.
- Expired Account Links route through refresh and generate a new one-time link.
- Incomplete return, pending verification, enabled, restricted, deleted, and deauthorized account states map to safe mobile states.
- Valid `account.updated` changes the seller row; duplicate delivery is harmless; an invalid signature returns HTTP 400.
- RLS prevents mobile writes to Stripe-controlled status and account fields.
- Sign-out during onboarding returns to an authentication-safe flow.
- Browse, Sell, Product Details, messaging, notifications, reporting, and authentication regressions are checked.
- No order, reservation, payment, charge, transfer, refund, dispute, or tax object is created.

Webhook processing is synchronous in this phase and deliberately small. If event volume or work expands, acknowledge receipt after a durable insert and process claimed events through a queue/worker.

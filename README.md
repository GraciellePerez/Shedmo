# Shedmo

A mobile marketplace for discovering, buying, and selling tools and equipment locally.

## Overview

Shedmo brings listings, seller profiles, conversations, and sale confirmations into one React Native application. The default launch mode supports local transactions arranged between users. The source also includes a gated Stripe test-mode checkout and fulfillment implementation.

## Features

- Email/password authentication, email confirmation, password recovery, and session persistence.
- Profiles, avatars, seller pages, and transaction-linked reviews.
- Listing creation and editing with photos, categories, condition, price, and location.
- Browse/search, filtering, distance sorting, saved items, and recently viewed listings.
- Listing-linked conversations, realtime text messages, and private image attachments.
- Local sale confirmation, sold status, and reciprocal review eligibility.
- Account deletion with profile anonymization and controlled record retention.
- User blocking, content reports, and an authorized staff moderation workspace.
- Push-notification registration and backend delivery/receipt processing.
- Optional Stripe test-mode Connect onboarding, checkout, pickup proof, shipping, payouts, refunds, and disputes.

These features are represented in the source. Availability in an installed app depends on migrations, function deployment, provider configuration, permissions, and launch flags.

## Tech Stack

React Native, Expo SDK 57, Expo Router, TypeScript, React, Supabase Auth/PostgreSQL/Storage/Realtime/Edge Functions, and Stripe. Tests use the Node.js test runner, PGlite database fixtures, and Deno. ESLint checks code quality; Git and GitHub provide version control.

## Architecture

Expo Router screens delegate to feature modules containing components, stores, repositories, and types. The shared Supabase client persists native sessions using secure storage. PostgreSQL migrations define tables, grants, row-level security (RLS), triggers, and transaction functions. Edge Functions authenticate callers and perform trusted operations.

Client input does not determine payment amounts, staff identity, or payout recipients. Payment workflows use server-derived state, signature-verified Stripe webhooks, and reconciliation routines. Local direct sales use a separate confirmation lifecycle and do not create Stripe orders.

## Project Structure

```text
src/app/                 Expo Router routes
src/features/            Marketplace feature modules
src/components/          Shared UI
src/config/              Launch flags
src/lib/supabase/        Client and session storage
supabase/migrations/     Database schema and security changes
supabase/functions/      Trusted backend operations
scripts/tests/           Application and database regression tests
assets/                  Application images, icons, and fonts
docs/                    Architecture, security, and testing documentation
```

## Setup

Use Node.js 24, npm, and the native tooling for your target platform. Android requires an Android SDK/emulator or device; local iOS builds require macOS and Xcode. Use a development build for the native integrations.

Clone this repository, open its directory, and install the locked dependencies:

```sh
npm ci
```

Copy `.env.example` to `.env` using your shell or editor. Set the URL and publishable/anon client key for your own development Supabase project. Keep both launch flags false for the default local-only mode.

### Backend

The client needs a configured Supabase backend; an empty project is insufficient. Review the migration sequence and `supabase/config.toml`. Configure a separate development project, apply migrations in order, and deploy the functions needed for the flows you are testing. Configure Auth confirmation/recovery redirects for the `shedmo` scheme and email delivery for that environment.

With the Supabase CLI installed, these commands illustrate migration review for your own development project:

```sh
supabase link --project-ref YOUR_DEVELOPMENT_PROJECT_REF
supabase migration list
supabase db push --dry-run
```

Review planned changes before applying them. Function deployment and backend secrets require separate configuration; see the feature guides below. There is no complete Docker Compose environment or one-command backend bootstrap. A Supabase local stack requires Docker and a separately prepared local configuration.

## Environment Variables

| Client variable | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Required Supabase API URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Required publishable or legacy anon client key |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Optional Stripe test publishable key |
| `EXPO_PUBLIC_ENABLE_PUBLIC_SHIPPING` | Defaults to false; enables the controlled shipping path |
| `EXPO_PUBLIC_ENABLE_PROTECTED_CHECKOUT` | Defaults to false; checkout also requires the shipping flag |

`EXPO_PUBLIC_*` values are bundled into the client. Never put a service-role key, database password, Stripe secret, or webhook secret there.

Backend-only variables are listed as commented placeholders in `.env.example`. Configure them separately for Edge Functions. The backend uses its own `ENABLE_PUBLIC_SHIPPING` and `ENABLE_PROTECTED_CHECKOUT` flags. Connect onboarding also requires return/refresh URLs, described in [the Connect guide](docs/stripe-connect-onboarding.md).

## Running the App

```sh
npm run android   # Build and run on Android
npm run ios       # Build and run on iOS (macOS)
npm start         # Start Metro for an installed development build
npm run web       # Web target; native flows need separate verification
```

Restart Metro after changing environment variables. Native dependency or plugin changes require rebuilding the development app.

## Testing

```sh
npm run typecheck
npm run lint -- --no-cache
npm test
npm run test:security
npm run test:deno  # Requires a separately installed Deno runtime
```

Node tests include source-level regressions and executable PostgreSQL fixtures through PGlite. Deno tests cover financial recovery helpers and staff report inspection. Neither suite substitutes for running Supabase Auth, provider webhooks, or physical-device testing.

The account-deletion runtime test is opt-in and rejects hosted URLs. It skips without its three `SHEDMO_DELETION_TEST_*` variables. See [testing and isolation](docs/testing.md) and [account-deletion validation](docs/account-deletion-production-verification.md).

## Security

Database RLS, column grants, participant/ownership checks, and service-only operations enforce access boundaries. Staff identity comes from verified authentication and trusted role records. Private chat images use scoped storage access and short-lived signed links. Native client sessions use Expo SecureStore.

Server credentials stay in backend configuration. Account deletion intentionally retains some transaction and safety references; storage deletion is outside the database transaction. Signed links and stateless access tokens have expiry-related limits. These are design properties, not certification of a deployed service.

Further reading:

- [Local-only launch flags](docs/public-v1-local-only-launch.md)
- [Local transaction architecture](docs/hybrid-local-transaction-model.md)
- [Account deletion design](docs/account-deletion-fix.md)
- [Moderation design and limitations](docs/v1-moderation-operations.md)
- [Stripe test checkout](docs/stripe-test-checkout-phase-d1.md)
- [Shipping security architecture](docs/shipping-safety-architecture-phase1.md)

## Project Status

Shedmo is an application and portfolio project under development. Local transactions are the default. Protected checkout and shipping remain gated, and the client accepts Stripe test publishable keys only. This repository does not establish App Store publication, production payment readiness, or completion of device and deployment validation.

Older phase documents describe historical design and testing stages; they are not statements of current deployment status. Legal/policy review, third-party asset rights, dependency review, and publication readiness remain separate work.

## Screenshots

No screenshots are included in this README. Public screenshots should use deliberately prepared synthetic accounts and contain no private account, payment, infrastructure, or device information.

## License

No application-level license has been selected. The bundled Outfit font includes its own `OFL.txt`; that license does not cover the application or other assets. Dependency license obligations remain applicable. See [asset provenance](docs/assets.md). An application license remains a separate owner decision.

## Build identity

The optional Expo owner field is omitted. Native bundle/package identifiers and the nonsecret EAS project ID are retained to preserve app identity and push-token configuration. Developers should configure their own EAS project and native identifiers before distributing a fork; doing so may require new signing and provider configuration.

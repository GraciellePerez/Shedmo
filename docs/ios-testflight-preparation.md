# iOS and TestFlight Preparation

Date: 2026-08-14

Scope: development Supabase project `YOUR_PROJECT_REF`, Stripe test mode, Expo/EAS preparation only. No Apple build, App Store Connect submission, Supabase deployment, production configuration, or live payment setting was performed.

## State before changes

- Expo SDK 57.0.0 (`expo` 57.0.13), React Native 0.86.2, React 19.2.3.
- Current iOS and Android identity: `com.gracielleperez.shedmo`; custom scheme `shedmo`.
- EAS project owner and project ID were already configured, but `eas.json` and `expo-dev-client` were absent.
- Stripe RN 0.64.0 is Expo-compatible, PaymentSheet uses `shedmo`, only `pk_test_` keys are accepted, and Apple Pay is not configured.
- Camera, image picker, notifications, location, Router, SecureStore, and Stripe config plugins were present. Generated camera copy described listing photos rather than protected-pickup QR scanning.
- Recovery and Stripe Connect callback classification was separated and protected-route gating was present. Signup verification had no explicit mobile redirect. Deep-link tests required unavailable Deno.
- Safe-area containers and iOS keyboard behavior covered the main auth, tabs, listing, checkout, messaging, fulfillment, settings, gallery, and admin screens. Native sharing used descriptive text and no invented public URL.
- EAS development/preview environments contained no build variables.

Expo SDK 57 supports iOS 16.4 and later and requires cloud/macOS native compilation. Windows cannot produce the iOS binary locally.

## Configuration prepared

- Final display name is `Shedmo`; iOS and Android identifiers are `com.gracielleperez.shedmo` before Apple/Google registration.
- The linked EAS project retains its non-user-facing remote slug `ProjectMarketplaceMobile`; its stable project ID and prepared environments remain unchanged because a local-only slug change makes EAS configuration invalid.
- Added iOS build number 1, iPhone-only support, and `ITSAppUsesNonExemptEncryption=false`. The app uses standard HTTPS/TLS and does not implement non-exempt cryptography.
- Installed the SDK-compatible `expo-dev-client`.
- Added `development` (physical iPhone/internal), `preview` (internal), and `testflight` (store distribution, preview environment, auto-increment) EAS profiles.
- Populated only EAS `development` and `preview` with the client-safe development Supabase URL/anon key and Stripe test publishable key. No EAS production environment was changed.
- Added truthful camera, photo, and location usage descriptions. Audio recording remains disabled. iOS image selection uses the system picker without requesting broad photo-library permission; Android retains its existing permission flow.
- Added `shedmo://auth/callback` for signup verification, a safe callback route, and session establishment. Recovery, signup, and payout callbacks remain distinct; malformed or cross-purpose links fail closed.
- Converted deep-link regression coverage to Node and added signup, cross-purpose, and malformed callback tests.

## Apple and service configuration required

Before the first physical-device build:

1. Confirm an active paid Apple Developer Program membership and permission to create certificates, identifiers, and device provisioning profiles for `com.gracielleperez.shedmo`.
2. Run `npx eas-cli device:create`, choose the website option, open its URL on the target iPhone, install the registration profile, and enable Developer Mode under Settings > Privacy & Security on iOS 16+.
3. In Supabase Dashboard > Authentication > URL Configuration for the development project, add these exact allowed redirect URLs if absent:
   - `shedmo://auth/callback`
   - `shedmo://reset-password`
4. Do not provide an Apple password in chat. Enter Apple ID, password, 2FA, team choice, and certificate/profile approval only in the official interactive EAS prompt.

The Stripe Connect `return_url` and `refresh_url` remain HTTPS development Edge Function endpoints. The two redirect function sources now target `shedmo:///settings/payouts/return` and `/refresh`; those exact development functions must be redeployed before testing Connect callbacks under the new scheme.

## Development build commands

After device registration and Supabase redirect confirmation:

```powershell
npx eas-cli build --platform ios --profile development
```

Accept the existing bundle identifier, select the correct Apple team, allow EAS to manage the development certificate/profile if desired, and select the registered iPhone. Do not use `--auto-submit`.

Install from the EAS build page/QR code, then start Metro on Windows:

```powershell
npx expo start --dev-client
```

Keep the iPhone and Windows computer on a reachable network. If LAN discovery fails, use Expo's tunnel option only for the Metro transport; it does not change backend or Stripe environments.

## Manual iPhone QA checklist

1. Launch cold while logged out; confirm Private Beta / Development / Stripe test mode and no blank screen.
2. Signup and email verification callback; login, logout, forgot/reset password, cold session restoration, and warm relaunch. Confirm no stale reset screen.
3. Open malformed, recovery, signup, Connect return, and Connect refresh links. Confirm each reaches only its intended route and logged-out payout routes require sign-in.
4. Create a listing using multiple photos; exercise limited photo access, preview, remove/reorder, upload failure, and retry. Add dispute evidence through the same picker.
5. Open seller QR scanner; allow permission, scan a valid buyer QR, test denial and Settings guidance, then verify backup PIN. No iOS bypass is allowed.
6. Exercise location allow/deny and approximate-distance behavior. Enable notifications from Settings, allow/deny, background the app, and test a notification tap.
7. Inspect safe areas, home indicator, tab bar, modals, keyboard/input fields, gallery, checkout, messaging composer, create listing, settings, fulfillment, and admin screens on the target iPhone.
8. Verify native share sheet text. Universal-link fallback remains deferred until a real public domain exists.
9. Scenario A: local direct sale, mutual confirmation, sold state, reciprocal reviews, and no Stripe object.
10. Scenario B: local Protected Checkout using Stripe test card, QR/PIN pickup, test payout, reviews, and no direct-sale conflict.
11. Scenario C: shipping Protected Checkout using Stripe test card, shipment, delivery/inspection, test payout, and reviews.
12. Recheck refunds, disputes, admin queues, analytics, audit, and normal-user admin rejection on iPhone.

## TestFlight preparation

The `testflight` profile is store-distribution-ready but intentionally uses the EAS `preview` environment so the first private build remains connected to development Supabase and Stripe test mode. Create only after physical development-build QA passes:

```powershell
npx eas-cli build --platform ios --profile testflight
```

Do not run `eas submit`, `npx testflight`, or `--auto-submit` without separate approval. App Store Connect will require an app record matching the bundle ID, agreements/tax/banking status as applicable, privacy-data answers based on actual collection, export-compliance confirmation, age/content ratings, beta review information, contact details, screenshots/metadata, and internal tester setup. Legal/privacy placeholder content and the npm audit findings require owner review; this document does not answer Apple legal questions on the owner's behalf.

## Readiness matrix

| Area | Status | Reason |
|---|---|---|
| Native configuration, bundle ID, schemes, EAS profiles | GREEN | Explicit and locally validated. |
| Stripe PaymentSheet / test-mode guard / Connect callbacks | GREEN | Compatible native SDK, custom scheme, test-key guard, no wallets. Physical return flow still needs device confirmation. |
| Auth and deep-link isolation | GREEN static / YELLOW runtime | Focused tests pass; Supabase redirect allowlist and real email callbacks need confirmation. |
| Hybrid direct/protected/shipping workflows | GREEN backend / YELLOW iPhone | Full development E2E passed previously; physical iPhone UI/payment flows remain manual. |
| Camera, QR/PIN, photos, location, notifications | GREEN config / YELLOW device | Permissions and code paths are prepared; hardware/system dialogs require iPhone testing. |
| Safe area, keyboard, share, admin UI | GREEN static / YELLOW device | Existing iOS-aware layout is present; target-device visual QA remains. |
| Build-time environment and bundle secrets | GREEN | Development/preview have client-safe values only; export scan found no server secrets or credentials. |
| Apple signing/device registration | RED until owner action | Requires paid Apple membership, device registration, team selection, certificates/profiles, and 2FA. |
| TestFlight submission metadata/legal/privacy | RED before submission | App record, truthful privacy/legal answers, metadata, agreements, and tester setup are not complete. |

The project is prepared to start the first iOS development build once the owner completes Apple device/signing interaction and confirms the two development Supabase redirect URLs. TestFlight submission is not yet authorized or ready.

# Exploratory QA strategy

This document preserves reusable coverage from development testing. Private account identifiers, transaction records, staff identities, deployment details, and screenshots are excluded. The cases below are a validation plan, not current certification of a hosted service.

## Core marketplace

- Exercise signup, email confirmation, sign-in, recovery, sign-out, and deep-link routing with synthetic accounts.
- Create and edit listings with varied photos, categories, conditions, prices, and manual locations. Distinguish empty inventory from query failure; runtime data must not silently fall back to demo listings.
- Verify search/filter pagination, distance sorting, favorites, and seller profiles.
- Test listing-linked messages and private attachments with participants, outsiders, and blocked pairs.
- Confirm direct local sales require an eligible conversation participant, buyer confirmation, and a single winning sale. Check sold state and reciprocal review eligibility.

## Optional protected checkout (Stripe test mode)

Both client and backend launch gates must be explicitly configured. Keep live provider credentials out of the test environment.

- Derive buyer totals and seller proceeds on the backend. Validate processing-fee reconciliation and any reserve or payout delay.
- Reject simultaneous direct/protected sales, duplicate checkout, self-purchase, and unauthorized participants.
- Verify webhook-authoritative payment state, expired reservation reclaim, one-time pickup PIN/QR expiry and replay rejection.
- For shipping, test destination access, price precision/bounds, deadlines, unsupported tracking, delivery and inspection transitions.
- Check disputes freeze payouts; seller response and authorized staff resolution must preserve audit records.
- Exercise cancellation, full/partial refunds, payout retry, and transfer reversal with deliberately disposable test fixtures. Repeated reconciliation must not duplicate external operations.

## Staff authorization and moderation

Normal users must not see or invoke staff functions. Test reports, scoped content inspection, suppress/restore revision checks, local-sales visibility, financial monitoring, and audit records. Moderation must not reverse completed transactions or manufacture sales. Use current moderation tests and design documents rather than older phase-specific claims about available actions.

## Regression lessons

Past development investigations motivated bounded reservation reclaim, narrow service-role column grants, explicit PL/pgSQL qualification, correctly targeted uniqueness constraints, sanitized Edge error parsing, and manual-location support. The forward migrations and tests retain that engineering evidence without publishing operational account records.

## Device and release limits

Camera QR capture, push receipt/taps, native permissions, sharing/deep-link returns, small-screen layout, accessibility, unreliable networks, and iOS/Android builds need physical-device validation. Dependency findings and policy review require separate assessment. Automated or historical QA results do not authorize a public launch.

See [testing and isolation](testing.md), [account-deletion validation](account-deletion-production-verification.md), and [moderation design](v1-moderation-operations.md).

# Private beta readiness

This checklist is for the development/test Supabase project and Stripe test mode. It is not approval for live payments or public launch.

## Accounts

- [ ] Sign up, email verification, sign in, sign out, password reset
- [ ] Seller Connect onboarding and return/refresh path
- [ ] Normal user denied staff routes and operations

## Listings

- [ ] Create, edit, archive/delete eligible listing, and staff hide/restore
- [ ] Upload, reorder, and display multiple images
- [ ] Search, category, condition, price, distance, pickup/shipping, and sort filters
- [ ] Prohibited-item report reaches staff queue

## Messaging

- [ ] Start conversation, send/receive message, unread state, pagination
- [ ] Confirm analytics never stores message contents

## Payments

- [ ] Stripe test-card success and failed-card path
- [ ] Duplicate checkout/payment prevention
- [ ] Webhook-authoritative success and processing-fee reconciliation
- [ ] Buyer total shows item + shipping and no buyer marketplace fee
- [ ] Seller sees marketplace fee, actual processing cost, reserve, and proceeds

## Pickup

- [ ] QR success, backup PIN success, replay/expiry/wrong-seller rejection
- [ ] Pickup completion and inspection/payout eligibility

## Shipping

- [ ] Tracking, buyer delivery confirmation, inspection window
- [ ] Seller cannot mark own shipment delivered

## Payouts, refunds, and disputes

- [ ] Risk/inspection payout delay, transfer, duplicate prevention, reconciliation
- [ ] Full refund, partial refund, transfer reversal success/reconciliation
- [ ] Buyer opens dispute, seller responds, staff resolves, payout remains frozen

## Admin and operations

- [ ] Reports, disputes, users, listing moderation, feedback, financial monitoring, analytics, audit log
- [ ] Cron invocation and Edge HTTP response health reviewed
- [ ] Webhook failures and stale/manual-review financial queues monitored
- [ ] No destructive automatic financial fix exists

## Security

- [ ] RLS and grants reviewed against deployed schema
- [ ] Service/Stripe secrets absent from client bundle and repository
- [ ] Analytics and feedback tables unreadable to normal users
- [ ] Analytics metadata contains no message, evidence, search text, Stripe IDs, tokens, or sensitive risk data

## Legal and policy

- [ ] Final counsel-approved Terms and Privacy Policy — **required before public launch**
- [ ] Final prohibited-items, refund/cancellation, dispute, seller-fee, processing-cost, and shipping-responsibility disclosures
- [ ] Draft in-app entry points reviewed for accuracy; drafts are not legal advice

## Release gates

| Area | Gate | Private-beta position |
|---|---|---|
| Auth | GREEN | Existing Supabase auth and recovery flows; device regression still required per build. |
| Listings | GREEN | Core CRUD/search/gallery/reporting present. |
| Messaging | GREEN | Scoped RLS, pagination, realtime, and no content analytics. |
| Checkout | GREEN | Test-mode, webhook-authoritative, idempotent D1 architecture. |
| Seller onboarding | GREEN | Connect test onboarding and eligibility checks present. |
| Pickup | GREEN | QR/PIN one-time proof and prior negative-case coverage. |
| Shipping | GREEN | Seller shipment and buyer delivery responsibilities separated. |
| Payouts | GREEN | Delayed, gated, idempotent test transfers with reconciliation. |
| Refunds | GREEN | Trusted service-only execution and reconciliation. |
| Disputes | GREEN | Private evidence, frozen payout, trusted resolution. |
| Admin | GREEN | Server-authoritative staff roles and append-only audit. |
| Analytics | YELLOW | Suitable lightweight first-party events; validate volume/retention after deployment. |
| Notifications | YELLOW | Foundation exists; production delivery/alerting is not a Phase G requirement. |
| Legal/policy | RED | Draft placeholders only; final legal review and published text are mandatory before public launch. |
| Monitoring | YELLOW | Staff queues and durable client errors exist; no external crash/on-call provider yet. |

## Manual deployment

```powershell
npx supabase migration list --project-ref YOUR_PROJECT_REF
npx supabase db push --project-ref YOUR_PROJECT_REF
npx supabase functions deploy admin-operations --project-ref YOUR_PROJECT_REF
npx supabase functions deploy reconcile-order-financials --project-ref YOUR_PROJECT_REF
```

Migration: `202608060023_add_phase_g_beta_readiness.sql`. Do not deploy to a project with divergent migration history. No native rebuild is required because Phase G adds no native package or config plugin.

## Monitored beta cadence

Before invitations, execute every unchecked path above using test accounts and Stripe test cards. During beta, review analytics, feedback, operational errors, webhook logs, cron HTTP results, and financial queues daily. Escalate any payout/refund/reversal item that remains reconciling beyond its expected worker interval; use only the existing safe retry.

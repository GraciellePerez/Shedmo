# Hybrid Local Transaction Model

Status: deployed and runtime-validated in development project `YOUR_PROJECT_REF`; production and Stripe live mode were not touched.

## Architecture and lifecycle

Pickup listings now present two separate paths. **Message Seller** starts a free, direct arrangement whose payment is outside Marketplace. **Buy with Protected Checkout** preserves the existing Stripe PaymentSheet, Connect separate-charge-and-transfer, QR/PIN pickup, payout, refund, and dispute path. Shipping-only listings expose Protected Checkout only.

A direct transaction uses `local_sale_confirmations`:

`active → pending_buyer_confirmation → confirmed`

Starting the request row-locks the listing, proves the seller owns a pickup-enabled active listing, derives the buyer from a conversation tied to that listing, requires actual message activity, rejects self-selection and conflicting protected orders, then atomically changes the listing to `pending_local_confirmation`. Buyer confirmation row-locks both records and changes the listing to `sold`. Rejection or seller cancellation changes only a still-pending listing back to `active` when no protected-payment conflict exists. A confirmed record cannot be changed through normal-user table access.

Normal users have SELECT-only participant access to confirmation rows. Inserts and transitions are trusted RPC-only. A partial unique index allows only one pending/confirmed direct sale per listing. The existing checkout reservation RPC still requires and locks an active listing, so it cannot start after the direct path locks inventory. The direct RPCs reject protected payment/order state and never access Stripe or financial tables.

## Identity, reviews, trust, and fees

Buyer identity comes from the existing server-validated `(listing_id, buyer_id, seller_id)` conversation relationship, not text input or caller-supplied buyer IDs. The seller UI lists only buyers returned by `get_direct_local_sale_buyers_v1`.

One-sided seller action never enables reviews. A confirmed local sale supports one review in each direction through a separate RPC, with the recipient derived from the confirmation. Reviews store `source = confirmed_local_sale`; protected order reviews remain `protected_checkout`. Public aggregates continue to use the shared review table.

Direct local sales create no PaymentIntent, charge, marketplace fee, processing fee, payout, refund, dispute, or transfer. The listing-price snapshot is retained only as product context and analytics input. UI language states that Marketplace confirmed mutual acknowledgement but neither processed nor verified payment and that Protected Checkout payment/refund protections do not apply.

## Product, analytics, and administration

- Listing detail: pickup shows direct messaging plus Protected Checkout; shipping-only shows Protected Checkout only.
- Messaging: a lightweight direct-payment safety notice links to confirmation status without censoring payment terms.
- Seller: Mark Sold opens trusted eligible-buyer selection; pending listings have a Waiting/Restore workflow.
- Buyer: an in-app notification and conversation link open Confirm Purchase / I did not buy this.
- Analytics: direct started/confirmed/rejected and protected selected/completed events are distinct. Admin metrics include path counts, direct completion rate, and average value by type.
- Admin: Local Sales is a read-only operational queue showing confirmation, participant, listing, status, and timestamps. No casual admin “confirm” action was added.

## Migration and deployment

Forward-only migration:

- `supabase/migrations/202608130031_add_hybrid_local_transactions.sql`
- `supabase/migrations/202608130032_allow_local_sale_analytics_entity.sql` (forward-only runtime repair for the analytics entity-type constraint)

Development deployment completed on 2026-08-14:

```powershell
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --linked
npx supabase functions deploy admin-operations --project-ref YOUR_PROJECT_REF
```

The pre-deployment dry run identified migration 031 as the only pending migration. Migration 031 and the updated `admin-operations` function were deployed only to development. Runtime testing then exposed a separate pre-existing analytics `entity_type` constraint that rejected `local_sale`; migration 032 adds only that value to the existing allowlist. It adds no analytics metadata fields, grants, or financial permissions. Migration 032 is applied and the final dry run is empty.

## Validation and E2E status

- TypeScript: PASS
- ESLint: PASS
- Expo Doctor: PASS (20/20)
- All Node-compatible D1/D2/D3/D3.1 and Phase E/F/G suites: PASS
- Hybrid transaction security suite: PASS (8/8)
- Supabase migrations 031 and 032: APPLIED to development; final push dry run reports up to date
- Deno-authored test: NOT RUN (Deno unavailable)
- Runtime Scenario A (free local direct sale): PASS, including mutual confirmation, no protected order/financial artifacts, reciprocal reviews, and duplicate-review rejection
- Runtime Scenario B (local Protected Checkout): PASS; Stripe test payment, $0.45 processing fee, PIN pickup, transfer, reciprocal reviews, and duplicate protections passed
- Runtime Scenario C (shipping Protected Checkout): PASS; shipping-only UI, Stripe test payment, $0.47 processing fee, shipment/delivery/inspection acceptance, transfer, reciprocal reviews, and duplicate protections passed
- Admin Local Sales/analytics/audit/security: PASS; pending and confirmed rows load, required metrics are present, fabrication is unsupported, and normal users receive 403
- Two-distinct-buyer runtime race: PASS. A fresh disposable Auth user with zero staff-role rows joined the existing buyer in two independently messaged conversations. Concurrent start requests produced exactly one winner; the losing buyer could not confirm, start Protected Checkout, or gain review eligibility. The seller could not confirm for the buyer, duplicate winner confirmation was idempotent, and the listing finished sold with one confirmation and zero protected orders.

The temporary payout helper was hard-coded to the two approved disposable order IDs, used a fresh in-memory 256-bit token, and accepted no caller-controlled identifiers or financial inputs. Its first invocation released two payouts; its second released zero. It was then undeployed, its secret and local source were removed, the endpoint returned 404, and the deployed-function list contained no QA helper.

## Native build and remaining TestFlight gates

No special native rebuild is required for the hybrid transaction implementation itself. The next iOS/TestFlight build will naturally include the Expo SDK 57 patch dependency updates applied during final validation.

Before iOS/TestFlight:

1. Complete the already documented physical-device, notification/deep-link, legal/policy, dependency-audit, and iOS coverage gates.

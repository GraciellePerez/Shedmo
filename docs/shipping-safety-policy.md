# Shedmo Shipping Safety Policy — Phase 2A Technical Baseline

This is product/technical guidance, not final legal language. Phase 2A and the Phase 2B.1 foundation are local-only and unapplied. No provider has been connected.

## Phase 2B.1 trusted tracking foundation

New Protected Shipping reservations use workflow version 3. Seller submission of USPS, UPS, or FedEx tracking is untrusted input: it creates `tracking_entered`, stores `tracking_submitted_at`, and leaves the order awaiting shipment. It does not set `shipped_at`, establish carrier possession, start inspection, alter `ship_by_at`, or affect payout eligibility.

Only a service-only, provider-neutral trusted-event processor may establish `tracking_validating`, `pre_shipment`, `carrier_accepted`, `in_transit`, `delivered`, `exception`, `invalid`, or `verification_delayed`. Carrier acceptance is the first trusted handoff signal and records `carrier_accepted_at`; trusted delivery records `delivered_at` and starts the existing idempotent 48-hour inspection window. A future adapter maps provider statuses to these normalized states and stores minimized provider metadata, never arbitrary provider payloads.

Before carrier acceptance, sellers may correct tracking at most twice. Corrections are recorded in append-only shipment events, do not reset or extend `ship_by_at`, and are blocked after acceptance or delivery. A partial uniqueness rule prevents the same normalized carrier/tracking pair from silently attaching to two active hardened outbound orders. Recycled historical numbers are a future operations-policy limitation.

Workflow versions 1 and 2 remain **LEGACY / MANUAL BETA FALLBACK**. Their manual seller-shipped and buyer-delivered paths remain readable and operable, but are never reclassified as carrier verified. For version 3, both legacy server paths fail closed. Clients have no table grants or RPC execute permission for trusted state, timestamps, provider identity, events, payout eligibility, or destination verification. `verification_delayed` is non-punitive and is distinguishable from acceptance; Phase 2B.1 does not automate deadline cancellation or refunds.

## Protected destination

Protected Shipping checkout requires a structurally valid US destination before the order is reserved. Shedmo stores only recipient name, two address lines, city, two-letter state/region, ZIP, and country. The snapshot is created in the same transaction as order reservation and is immutable afterward. Profile edits, listing edits, messages, and checkout retries cannot change it. A post-payment change requires cancellation/refund and a new checkout; there is no general admin correction operation.

The destination is structurally accepted by Shedmo, **not carrier verified**. The buyer may read it. The seller may read it only after successful payment, when it is operationally required. Unrelated users cannot read it. Full addresses must never enter analytics, logs, notifications, provider history, messages, or debug output.

## Ship-by deadline

For workflow-version-2 shipping orders, trusted Stripe payment success records `ship_by_at`. The paid local calendar day is excluded; the next three Monday–Friday days count; the deadline is the exclusive start of the following local day. It is calendar-based, not 72 hours.

Phase 2A uses the server-owned IANA fallback `America/Chicago` and records `ship_by_timezone_source=platform_fallback`. Calendar calculation occurs in that zone before conversion to UTC, preserving 23- and 25-hour DST days. Holidays are not excluded in V1.

The deadline is immutable and idempotent. It does **not** yet trigger cancellation, refund, relisting, or payout changes. Trusted carrier verification and deadline enforcement depend on Phase 2B.

## Legacy compatibility

Historical orders retain `shipping_workflow_version=1`, null destination/deadline fields, and their current financial resolution paths. Old seller-entered shipment data is legacy/manual beta data and is not reclassified as carrier verified. New hardened shipping reservations use version 2. Local pickup behavior is unchanged.

## Flat shipping price

Seller-entered flat shipping remains supported. Values must be non-negative exact integer cents with at most two decimal places. The development baseline stores a server-owned configurable maximum of $500 (`50,000` cents); $500 is allowed and higher values are rejected. There is no percentage-of-item-price rule. Marketplace fee remains based on item price only, buyer fee remains $0, and Stripe processing/refund/payout policy is unchanged.

## Readiness

- Phase 2A development runtime: YELLOW; core checkout, payment, destination,
  deadline, price, legacy, and pickup checks pass, while the remaining
  authenticated RLS/idempotency runtime cases below are still open.
- Controlled private-beta shipping: RED until Phase 2B trusted carrier acceptance, delivery authority, outage handling, and deadline enforcement.
- Public shipping: RED; Phase 2B plus return/admin/operational policy work remains required.

## Development runtime checkpoint — 2026-08-16

Development project `YOUR_PROJECT_REF` has migrations 034–036 applied and
`create-checkout-payment` deployed in Stripe test mode. A disposable $10 item
with $5 shipping completed PaymentSheet for a $15 buyer total with a $0 buyer
fee. Buyer and paid seller views both showed the frozen synthetic destination
and the server-owned deadline. A Sunday August 16 payment produced Thursday
August 20 at 00:00 America/Chicago (2026-08-20T05:00:00Z), which excludes the
paid day, counts Monday through Wednesday, and uses the exclusive next local
midnight boundary.

Runtime testing found and fixed shipping input precision truncation and two
PL/pgSQL output-column ambiguities in the v2 reservation path. Legacy shipping
history remained readable and explicitly labeled manual/not carrier verified;
protected pickup history remained destination-free.

The buyer, paid-seller, price-boundary, payment, deadline, legacy, and pickup
checks passed. Seller-before-payment, unrelated-user destination reads, direct
table mutation attempts, profile-address-change isolation, and duplicate
webhook deadline stability still require a dedicated authenticated runtime
harness or another carefully staged fixture. Static RLS/grant and idempotency
tests cover those guards, but they are not represented here as runtime passes.

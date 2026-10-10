# Shipping Safety Architecture — Phase 1 Audit and Plan

Status: architecture proposal, updated by the local-only Phase 2B.1 foundation. No migration has been applied, no provider account or credential has been configured, and no deployment is authorized by this document.

Phase 2A note: the approved immutable destination, workflow versioning, exact shipping-price ceiling, and three-business-day deadline foundation were implemented locally in migration `202608160034_add_phase_2a_shipping_foundation.sql`. Phase 2B.1 adds a local-only workflow-version-3 provider-neutral shipment/event model: seller tracking is `tracking_entered`, while only service-role trusted events can establish carrier acceptance or delivery. Real provider verification, polling/webhooks, deadline enforcement, refunds, and returns remain future work; see `docs/shipping-safety-policy.md`.

## Executive decision

Preserve Direct Local Sale, optional Protected Local Pickup, Stripe PaymentSheet, separate-charge delayed transfers, refund/reversal reconciliation, reviews, disputes, messaging, listing/order snapshots, staff authorization, and the notification outbox. Harden only Protected Shipping around those foundations.

Current controlled-beta shipping is **RED** until carrier acceptance and delivery stop being user-asserted and a server-owned deadline/refund worker exists. Public shipping is **RED** additionally because there is no immutable protected destination, verified return workflow, reliable destination match, mature shipping-operations queue, or finalized cancellation/high-value policy.

Preferred V1: a provider-neutral tracking domain with an **EasyPost tracking-only adapter**, webhooks plus bounded polling, and one outbound shipment per order. Provider selection is replaceable; business decisions use Shedmo-normalized states only.

## 1. Current shipping architecture and end-to-end trace

### Checkout, payment, and order creation

1. `CheckoutScreen` offers shipping only when the listing says it is available. It asks `create-checkout-payment` for the server total and displays Item, Shipping, Tax, and Total before PaymentSheet. There is no buyer fee. Tax is explicitly zero in this beta.
2. `reserve_listing_for_checkout` locks the listing, verifies it is active, blocks self-purchase, validates fulfillment availability and seller payout eligibility, snapshots listing title/condition/category/primary-image path, converts item/shipping decimal prices to integer cents, computes the marketplace fee from **item cents only**, reserves the listing, and creates one idempotent order using `client_checkout_key`. The partial unique order index and listing row lock prevent two live protected orders.
3. `create-checkout-payment` creates/reuses one Stripe PaymentIntent. Amount, currency, order/listing/buyer/seller metadata, and the persisted payment claim are checked on reuse. The client receives only the PaymentSheet secret and trusted summary.
4. The signature-verified `stripe-webhook` validates PaymentIntent data against persisted order/payment fields. `apply_checkout_payment_event` rejects stale failure regression, changes a successful shipping order to `awaiting_shipment`, records `paid_at`, and changes the listing to `sold`.

### Shipment through payout

1. Seller enters carrier, tracking number, and a **client-generated** `shippedAt` in `FulfillmentOrderScreen`.
2. Authenticated `mark-shipped` validates the caller, but its service-only RPC immediately inserts `order_shipments` and changes `awaiting_shipment → shipped`. No carrier lookup occurs.
3. The buyer can press **Mark delivered**. Authenticated `mark-delivered` changes `shipped → inspection_window`, sets server `delivered_at`, and sets `inspection_expires_at = delivered_at + 48 hours`.
4. Buyer may accept early, or the service-only inspection reconciler expires due windows. Either path makes the order eligible only if no dispute/financial hold applies.
5. Seller risk tier determines `payout_not_before`. `prepare_seller_payout_v2` row-locks the order and blocks payout for unsettled fees, open disputes, refunds/reversals, holds, incorrect fulfillment/payment state, restricted sellers, or an undelapsed delay.
6. `release-seller-payout` or `reconcile-order-financials` creates/recover-checks a Stripe transfer using a persisted reference and idempotency key. Finalization completes the order. Ambiguous failures remain `reconciling`; duplicate transfer creation is guarded.

### Current authoritative boundaries

| Area | Current authority | Assessment |
|---|---|---|
| Price, fee, total, order ownership | locked DB RPC + Stripe webhook | strong |
| Payment success | Stripe webhook | strong |
| Tracking string/carrier | seller input through authenticated function | appropriate as untrusted input |
| Shipped/carrier possession | seller input immediately becomes server state | unsafe |
| Delivered | buyer button immediately becomes server state | unsafe for public shipping |
| Inspection clock | server time, but triggered by buyer assertion | partially safe |
| Refund/reversal/payout | service-only claims, row locks, Stripe idempotency/recovery | strong foundation |
| Dispute decision | staff-authorized service RPC | strong foundation |

### Tables, functions, jobs, and UI

- Tables: `listings`, `listing_images`, `orders`, `payments`, `order_shipments`, `order_status_history`, `stripe_webhook_events`, `seller_payment_accounts`, `seller_payout_releases`, `order_refunds`, `transfer_reversals`, `seller_financial_adjustments`, `order_disputes`, `marketplace_notification_events`, `marketplace_analytics_events`, `staff_roles`, `staff_action_log`, and `marketplace_reconciliation_runs`.
- Edge Functions: `create-checkout-payment`, `stripe-webhook`, `mark-shipped`, `mark-delivered`, `accept-delivery`, `cancel-order`, `open-order-dispute`, `respond-order-dispute`, `process-order-refund`, `release-seller-payout`, `reconcile-order-financials`, and `admin-operations`.
- Important RPCs: reservation/payment application; `mark_order_shipped`; `mark_order_delivered`; inspection expiry/early acceptance; dispute open/respond/resolve; cancel; refund/reversal preparation/finalization; payout preparation/finalization.
- Scheduled foundation: expired checkout reservation cron exists. Financial/inspection reconciliation is a bounded service worker, but repository configuration does not show a shipping-deadline or carrier-reconciliation cron.
- Notification foundation: transition trigger inserts service-only outbox rows with unique logical `event_key`. It currently emits order-confirmed, seller-entered shipment, inspection-started, completion/review, and payout events. The existing Expo push function processes only the separate `notifications` table’s message/favorite types; the marketplace outbox is a safe foundation, not yet a complete order push pipeline.
- Admin: reports, disputes, local sales, users, listings, financial reconciliation, analytics, monitoring, feedback, and append-only action audit exist. There is no shipping-issues queue.

## 2. Current weakness/risk matrix

GREEN means safely handled now; YELLOW means partial/beta limitation; RED means material gap.

| Question | Risk | Finding |
|---|---:|---|
| Seller-entered tracking immediately marks shipped | RED | Explicitly possible; carrier possession is never verified. |
| Random tracking bypasses shipment deadline | RED | No `ship_by_at`, tracking verification, or overdue worker exists. |
| Client-controlled delivered state | RED | Buyer button is the only implemented delivery transition. |
| Client-controlled ship-by deadline | GREEN | Client cannot edit one, but no deadline exists. |
| Duplicate refunds | GREEN | Unique claims, stable references, recovery lookup, Stripe idempotency, and locked finalization exist. |
| Refund + payout race | YELLOW | Current gates/row locks are strong, but shipping auto-cancel needs a single serialized claim spanning acceptance/cancellation/refund eligibility. |
| Stripe webhook + scheduler race | YELLOW | Payment regression is guarded; a future shipping scheduler has no serialization design yet. |
| Duplicate payout | GREEN | One release/order, persisted trusted claim, Stripe recovery/idempotency, and finalization guards. |
| Stale shipment regression | RED | No provider-event history, precedence, or event-time guard. |
| Seller edits another seller’s shipment | GREEN | authenticated caller ID is checked against locked order seller. |
| Buyer mutates shipment state | GREEN | Buyer cannot call seller shipment RPC successfully. |
| Wrong-order tracking mutation | GREEN | order ownership and type/state are locked and checked. |
| Listing reactivated before refund settlement | GREEN | Paid cancellation currently does not reactivate at all. That avoids premature resale but creates a YELLOW post-refund operational gap. |
| Tracking reused across Shedmo orders | RED | No normalized carrier+tracking uniqueness/history. |
| Tracking changed after acceptance | YELLOW | No edit path currently; Phase 2 needs an explicit correction path and immutable acceptance history. |
| Address changed after checkout | RED | No authoritative shipping-address snapshot exists in the order or PaymentIntent creation flow. Messages can create ambiguity. |
| Buyer cancels after physical shipment | YELLOW | DB blocks cancellation once marked `shipped`, but provider lag leaves a dangerous pre-acceptance interval. |
| Seller cancellation races carrier acceptance | RED | No trusted acceptance or final lookup exists. |
| Suspension affects in-flight transaction | YELLOW | protected rows use restrictive foreign keys and remain resolvable; suspension blocks new selling/checkout, but explicit in-flight permissions/ops policy is incomplete. |
| Provider outage causes unjust cancellation | GREEN today / RED if naively added | No provider exists today. Phase 2 must implement delayed verification and final recheck, never outage=invalid. |
| Historical orders unreadable after new rules | GREEN foundation | restrictive FKs, snapshots, participant RLS, and migration 033 preserve history; new fields must remain nullable for legacy rows. |
| Seller-controlled `shippedAt` | RED | client sends it; RPC only rejects >5 minutes in future, so backdating is possible. |
| Shipping amount tampering | YELLOW | server reads listing and stores cents, but DB has no explicit shipping maximum and numeric-to-cent rounding permits more than two stored decimal places. |

## 3. Three-business-day deadline and timezone model

At trusted payment application for a shipping order, compute and persist `ship_by_at` and `ship_by_timezone`; never accept either from the app. The clock begins when payment success makes the order eligible for shipment (`awaiting_shipment`), not PaymentSheet completion or seller opening the app.

Definition: skip the paid calendar day; count the next three Monday–Friday local calendar days; deadline is the last representable instant of day three, implemented as the **start of the following local day converted to UTC** (exclusive boundary). At `now >= ship_by_at`, it is overdue. Holidays are a documented V1 limitation.

- Paid Monday 4 PM: Tue day 1, Wed day 2, Thu day 3; expires Friday 00:00 local.
- Paid Friday/Saturday/Sunday: Mon day 1, Tue day 2, Wed day 3; expires Thursday 00:00 local.
- Store UTC `timestamptz` plus the IANA zone used and calculation version. Never use a fixed UTC offset.
- Resolve zone server-side from the listing’s frozen approximate coordinates/postal location using a versioned timezone resolver. Listing `location_source=device/profile` plus coordinates is preferable. Manually entered city/state without reliably resolved coordinates is insufficient.
- Fallback: `America/Chicago`, explicitly recorded as `timezone_source='platform_fallback'`, until the seller confirms a supported zone. This is deterministic and server-authoritative, though imperfect.
- DST: calendar arithmetic occurs in the IANA zone, then converts the next-day boundary to UTC; a 23/25-hour day is therefore correct. Ambiguous/nonexistent midnight should use the timezone library’s start-of-day behavior and be regression-tested.

Deadline tests: every weekday; Friday/weekend payment; leap date; spring-forward/fall-back in affected zones; missing/invalid location fallback; paid exactly around local midnight; exactly-at-boundary overdue; client timezone/date ignored; seller update denied; recomputation idempotent; legacy null deadline.

## 4. Reminder/outbox architecture

Retain `marketplace_notification_events` and its unique `event_key`. Add server-derived event types and deterministic keys:

- `order:{id}:shipment_required:v1`
- `order:{id}:shipping_one_business_day:v1`
- `order:{id}:shipping_deadline:v1`
- `order:{id}:carrier_accepted:v1`
- `order:{id}:shipment_exception:{provider_event_id}`
- `order:{id}:delivered:v1`
- `order:{id}:inspection_started:v1`

Immediate state transitions enqueue in the same transaction but notification failure must not undo financial truth (matching the current guarded-trigger philosophy). A bounded reminder worker selects due orders `FOR UPDATE SKIP LOCKED`, inserts event keys `ON CONFLICT DO NOTHING`, and records attempt/dispatch state separately. “One business day remaining” is a calculated milestone, not repeated rolling pushes. Do not add a new push vendor; extend the existing outbox-to-notification delivery path later.

## 5. Trusted shipment state model

Use the smallest normalized state set: `tracking_entered → validating → pre_shipment → carrier_accepted → in_transit → delivered`, with side outcomes `exception`, `invalid`, and `verification_delayed`. `unknown` is provider data, not permission to punish either party. `carrier_accepted` is the first state that satisfies the shipping deadline. Label created / electronic information received is only `pre_shipment`.

Store one `order_shipments` row per V1 order plus append-only events:

- normalized carrier and normalized tracking hash/value; direction=`outbound`
- provider key, provider tracker ID, provider mode
- normalized state and monotonic rank/terminal flag
- raw provider status/code (bounded), trusted source, provider event time, received time, last verified time
- accepted/delivered timestamps, provider destination ZIP/city/state only when supplied, `signed_by` only when supplied and needed
- active tracking version, correction reason/actor/time
- append-only external event ID/payload digest/status history; retain only minimized diagnostic fields, not unnecessary raw PII

Seller input is mutable only before trusted acceptance and only through a server action. After acceptance, carrier/tracking/provider ID and acceptance evidence are immutable; change requires a narrow audited admin correction that preserves the old version and never erases events.

## 6. Tracking correction, reuse, and fraud

Before acceptance, seller may replace a typo at most a bounded number of times (recommended: two), with reason and complete history. The old tracker is retired, not deleted from Shedmo history. Deadline does not restart. After acceptance, seller edit is blocked; staff may correct only with documented evidence and a new immutable shipment version.

Normalize carrier identifiers and tracking (uppercase, remove carrier-approved separators only). Enforce a partial unique invariant on `(carrier, normalized_tracking, direction)` across non-test historical outbound shipments, not merely active orders. Because carriers recycle numbers, automatic reuse should be blocked inside a configurable lookback (recommended 18 months) and routed to staff outside it. Return tracking uses `direction=return` and must reference its dispute/return. A manual override is admin-only, reason-required, audited, and never makes the tracking number proof that it belongs to this order. Compare origin timing, acceptance after this order was paid, destination evidence, and impossible concurrent use.

## 7. Provider comparison and recommendation

Research checked 2026-08-16; verify commercial terms again before contracting.

| Option | Strengths | Weaknesses / beta fit |
|---|---|---|
| Direct USPS/UPS/FedEx | First-party data; carrier-specific evidence may be richest. USPS Tracking 3.2 exposes events/location; each uses OAuth/account onboarding. FedEx advanced webhooks offer richer proof. | Three adapters, credentials, quotas, schemas, outage modes, and webhook systems. UPS credentials tie to shipper accounts. FedEx advanced webhooks require a US account and currently start at $199/month for up to 7,500 tracking numbers. Poor private-beta complexity/cost. |
| EasyPost tracking-only | One normalized API, 100+ carriers, standalone trackers, historical events, webhook HMAC, polling, signed-by and destination fields when carriers provide them; future labels possible without making labels Phase 2. Verified standalone price: USPS $0.03, non-USPS $0.02 under the cited free-access terms. | Some standalone carriers require connected carrier credentials (official support explicitly lists FedEx). Location/timezone/destination/signature availability varies. Tracking IDs can recycle. Provider dependency. |
| Shippo tracking-only | One normalized interface, webhooks, broad carrier network, future labels/address validation. Public API pricing currently lists $0.02/track. | Official docs reviewed did not clearly document a signed inbound webhook verification mechanism comparable to EasyPost HMAC; resolve contract/security behavior before selection. Destination scan location is not necessarily destination identity. |

Recommendation: **EasyPost-first behind a Shedmo adapter**, contingent on confirming standalone USPS/UPS/FedEx coverage and required FedEx credentials during Phase 2 procurement. EasyPost’s documented HMAC and transparent low tracking price are the differentiators. Do not import an SDK initially; a small server HTTP adapter reduces lock-in.

Exact general API rate limits were not reliably published across all compared plans in the official material reviewed; obtain written limits/SLA terms before procurement and design the worker to honor `429`/retry headers regardless.

Primary sources: [EasyPost Tracker API](https://docs.easypost.com/docs/trackers), [EasyPost tracking guide](https://docs.easypost.com/guides/tracking-guide), [EasyPost webhook/HMAC](https://docs.easypost.com/docs/webhooks), [EasyPost tracker billing](https://support.easypost.com/hc/en-us/articles/360042414212-Billing-Payments), [EasyPost credential limitations](https://support.easypost.com/hc/en-us/articles/360044353091-Understanding-Trackers), [Shippo API pricing](https://goshippo.com/pricing/api), [Shippo tracking endpoint](https://docs.goshippo.com/api-reference/tracking-status/register-a-tracking-webhook), [USPS Tracking 3.2](https://developers.usps.com/apis?check_logged_in=1&page=3), [UPS OAuth onboarding](https://developer.ups.com/get-started), and [FedEx visibility/pricing](https://developer.fedex.com/api/en-do/announcements/Introduction_to_Integrated_Visibility_Portfolio.html).

Destination limitation: EasyPost may expose destination city/state/ZIP, scan locations, and `signed_by`, but fields are carrier-dependent and nullable. Address validation answers “is this address plausible”; a delivered scan answers “what the carrier reported”; neither universally proves this tracking number was delivered to this Shedmo order’s full address. Treat ZIP/city/signature match as evidence, not automatic dispute resolution, and avoid persisting full destination from provider payloads.

## 8. Provider-neutral interface and responsibilities

Conceptual adapter operations: `createTracker`, `fetchTracker`, `normalizeEvent`, `verifyWebhook`, `extractDestinationEvidence`, and `classifyFailure`. Adapter inputs are normalized carrier/tracking and an internal correlation token; outputs are provider-neutral status/evidence objects.

- Adapter: authentication, provider request/response mapping, HMAC verification, provider IDs, rate-limit/error classification.
- Shared shipping domain: authorization, reuse checks, monotonic transition rules, deadline/cancellation/payout policy, event dedupe, privacy, audit.
- Webhook handler: raw-body signature check before parsing, event claim/dedupe, lookup by persisted provider tracker ID (never caller order ID), append event, invoke locked domain transition, return quickly.
- Reconciler: claims bounded due shipments, fetches provider, feeds the same domain transition function, applies retry/backoff, emits monitoring.

Provider failure becomes `verification_delayed`, with exponential bounded retries and jitter. It does not mean invalid tracking, missed deadline, or refund. At deadline, an outage places the order into `cancellation_pending/reconciling`, blocks payout, preserves buyer funds, and alerts operations. After a configurable grace/retry period, staff resolves with carrier evidence; the platform’s inability to reach a provider never automatically punishes seller or buyer.

## 9. Carrier acceptance, pre-cancellation, cancellation, and races

Acceptable possession evidence is a trusted provider event equivalent to carrier origin scan, carrier pickup, accepted/tendered, or in-transit. Label created, manifest generated, electronic data received, and unknown are not acceptance.

Overdue flow:

1. Bounded worker claims the due order with a persisted cancellation-attempt/version and row lock; sets `cancellation_pending`/transfer hold.
2. Outside the transaction, perform a fresh provider lookup when reachable.
3. Re-lock order and shipment; reject stale claim if versions changed.
4. If accepted event-time evidence exists, atomically record acceptance and restore fulfillment path—no cancellation.
5. If still unaccepted and provider response is authoritative, atomically mark cancellation claimed, prepare the existing full-refund claim, and keep listing non-active.
6. Existing refund worker creates/reconciles Stripe refund. Only after full refund success (and any transfer reversal, though payout should never have occurred) may a separate locked finalizer reactivate the listing if it is still `sold`, belongs to the same seller/order, is not moderated/restricted, and no newer live transaction exists.

Serialization rules:

- Every state decision locks order then shipment in a consistent order and compares state version/provider event time.
- Webhook and polling share one idempotent transition function and unique external-event key.
- Acceptance wins over unexecuted cancellation when evidence shows carrier possession before the deadline/final decision. Once Stripe refund creation is durably claimed, late acceptance cannot restart payout; route to staff and return handling.
- Tracking submitted moments before deadline does not satisfy it; only acceptance evidence does.
- Refund claim immediately holds payout. Payout preparation must also reject cancellation/return states.
- Dispute opening and inspection expiry serialize on order; an open dispute wins and holds payout.
- Seller/buyer cancellation rechecks provider immediately before committing. No path permits refund+payout, relisted+shipped, duplicate external financial operations, or delivered-state regression.

## 10. Seller and buyer cancellation policy

Seller V1: may cancel while paid/awaiting shipment, including pre-shipment tracking, only after a fresh provider check shows no acceptance. Deadline does not need to elapse. Full buyer refund; no payout; listing reactivates only after refund settlement and safety checks. After acceptance, self-service cancellation is blocked; use dispute/return/admin flow. Emit `seller_unfulfilled_cancellation` analytics/audit.

Buyer V1 recommendation requiring product approval: allow self-service cancellation only before any tracking is entered **and** a final provider/order recheck confirms no fulfillment activity. After tracking entry—even pre-shipment—change to “Request cancellation,” requiring seller agreement or staff review, because physical handoff can precede provider updates. After acceptance, no cancellation; use delivery/dispute/return rules. Decide whether seller non-response before deadline converts the request automatically; recommended no, because the deadline worker already provides the remedy.

## 11. Shipping address immutability and privacy

Current gap: there is no order shipping-address snapshot and PaymentIntent does not collect/freeze one. Listing location is seller origin context, not buyer destination.

Phase 2 must collect a validated destination before payment, then freeze an encrypted/minimized order address snapshot at successful order creation/payment: recipient name, address lines, city, state, postal code, country, validation source/result/version, and a keyed destination fingerprint/ZIP for matching. Expose only to the order buyer, seller as operationally necessary, and trusted services/staff. Do not place full address in analytics, logs, notification payloads, provider raw-event history, or messages.

Before payment, buyer can edit and revalidate. After payment, neither profile edits nor messages alter protected destination. A correction requires cancel/refund and new checkout unless a narrow audited staff flow is later legally/operationally approved. “Ship somewhere else” messages are evidence only.

## 12. Delivery and 48-hour inspection

Provider `delivered` drives a locked, monotonic transition, sets `delivered_at` from the trusted carrier event timestamp when credible (bounded against receipt time and prior events), records receipt time separately, and sets `inspection_expires_at = delivered_at + 48 hours`. Duplicate delivery is idempotent. Delivered cannot regress to in-transit; later exception events append evidence and may open an operational issue without rewriting delivery truth.

Current inspection duration and payout hold are good, but the start signal is not trusted. Preserve early buyer acceptance and service expiration; remove buyer “Mark delivered” as authority. For controlled beta, staff may start inspection only with audited carrier/manual evidence when provider support fails. Payout stays held during inspection, dispute, return, refund, reconciliation, or provider uncertainty.

## 13. Dispute policies and evidence

### Item Not Received

Never refund on button press alone.

- Never accepted: deadline cancellation/full refund path.
- Returned to sender: hold payout; verify return, then staff decides refund and listing disposition.
- Delivery failure/exception: remain reconciling; buyer/seller not automatically penalized.
- Wrong destination: compare frozen destination fingerprint/ZIP with available provider evidence; staff resolves.
- Carrier delivered: consider event history, destination evidence, signature/photo if available, buyer explanation, seller evidence, carrier case, and messages. Conflicts stay moderator decisions.

### Materially Not As Described / damaged in transit

Current buyer evidence supports up to eight private images and explanation; seller has text response. Extend seller evidence storage and category-specific prompts. Buyer should provide item/problem, packaging, exterior box, and shipping-label photos; seller should provide listing snapshot/photos, explanation, packing/handoff evidence, and relevant messages. Video is not Phase 2 unless a separately secured media design exists. No automatic merits decision.

For damage, separate inadequate packaging, apparent carrier damage, and uncertain cause. Without Shedmo-purchased insurance, do not promise carrier reimbursement. Staff may approve return/refund while financial liability is handled through existing seller adjustment architecture. This limitation keeps controlled beta YELLOW and public shipping RED until operations and policy are proven.

Evidence storage must enforce order participant paths, private MIME/size rules, immutable hashes, signed reads, retention, and staff audit. Messages are supporting evidence, never mutable transaction truth.

## 14. Minimum return workflow

State machine: `return_required → awaiting_buyer_shipment → return_tracking_entered → return_pre_shipment → return_carrier_accepted → return_in_transit → return_delivered → refund_ready → completed`. Side states: `return_exception`, `return_overdue`, and trusted `refund_without_return`. One return tracking number; same provider normalization, reuse, webhook, polling, and monotonic rules as outbound.

Only an approved dispute/admin outcome creates a return. Buyer submits tracking; carrier acceptance proves handoff. Refund is prepared only when policy’s return condition is met, normally trusted return delivery. `refund_without_return` is admin-only, reason-required, audited, and amount derived from allowed policy—not arbitrary input.

No integrated return-label purchase in this phase. Controlled beta may obtain/pay labels operationally and record only carrier/tracking/status. Proposed configurable policy (not legal language): seller-fault materially-not-as-described generally makes seller responsible for reasonable return shipping; buyer remorse is not covered unless seller voluntarily agrees. Because Shedmo cannot directly debit a seller bank account, use held proceeds first, then existing seller financial adjustments/future payout deductions with caps and staff review. Product approval is required for limits, voluntary returns, and negative-balance handling.

## 15. High-value and shipping-price controls

Existing order cap is $5,000 item cents and new-seller manual review begins above $1,000. Keep values configurable. Proposed beta defaults for approval: signature recommended at $500; required at $1,000; manual review at $1,000 for new sellers / $2,500 generally; risk-based payout delays remain 7 days by default and can be lengthened for high risk. These are product/risk decisions, not permanent constants.

Preserve flat seller-entered shipping for beta and server calculation. Add schema/client/server validation for maximum two decimal places, integer-cent conversion without silent rounding, non-negative value, and configurable maximum (proposal: lesser of $500 or 50% of item price, with staff-approved exceptions). Checkout already shows Item, Shipping, Tax, Total and has no buyer fee; add explicit “Buyer fee: $0” if product wants the thesis reinforced. Marketplace fee remains item-only; seller-paid Stripe processing remains unchanged.

Add report reason `excessive_or_deceptive_shipping`, admin visibility beside item/shipping comparison, and server analytics `shipping_charge_reported`. No automatic fraud judgment.

## 16. Webhooks and polling

Webhook endpoint requirements: public HTTPS but provider-HMAC authenticated; preserve raw bytes until verification; reject invalid/replayed signatures; secret server-only; map by persisted provider tracker ID plus carrier/tracking match; persist unique external event ID or provider+payload digest; append minimized event history; claim idempotently; reject wrong-order mapping; normalize; apply monotonic transition under row lock; acknowledge duplicates. Do not log raw address/signature PII.

Polling complements webhooks: batch-limit active/nonterminal trackers, prioritize pending deadline/delivery/exception, use `FOR UPDATE SKIP LOCKED` leases, provider-aware rate limits, exponential backoff/jitter, and stop normal polling at terminal delivery/cancel/return completion. Continue slower reconciliation for ambiguous terminal operations. Webhook and poll call the same transition function, so simultaneous updates dedupe and stale events cannot regress state.

V1 scope is exactly one outbound shipment and one active tracking number per order. Multi-package/split shipment is a documented future limitation.

## 17. Moderation and in-flight orders

Order/profile/listing financial references use `ON DELETE RESTRICT`, snapshots preserve title/image context, and migration 033 preserves participant reads. Staff suspension currently blocks new selling/checkout rather than deleting history. Keep this.

- Suspended seller: block new listings/checkout and self-service payout initiation if desired, but service reconciliation, refund, dispute response window, return receipt, and staff resolution must continue; valid proceeds remain held/resolvable, not confiscated automatically.
- Suspended buyer: block new checkout but preserve read/evidence/refund/return access or provide staff-assisted equivalent.
- Account deletion: defer hard Auth/profile deletion while financial retention obligations/in-flight orders exist; deactivate login and retain minimized transaction records.
- Removed listing: never cascade an order; preserve snapshots and participant history. Admin already blocks hiding reserved/sold listings.

Explicitly test all four cases; authorization must distinguish “cannot start new commerce” from “must resolve existing transaction.”

## 18. Minimum UI state requirements (future, not implemented)

Seller can extend existing `FulfillmentOrderScreen`: Ship by date; enter/correct tracking; validating; label created/waiting for acceptance; carrier has package; in transit; delivered; exception; overdue/reconciling; cancellation/refund; and return required/received. Replace “Mark shipped” semantics with “Submit tracking.”

Buyer: seller must ship by date; tracking submitted; carrier accepted; in transit; delivered; 48-hour countdown; accept early; report problem; dispute evidence/status; return states. Remove authoritative “Mark delivered”; a non-authoritative “I received it” may be product-approved only as early acceptance with clear language.

Recommended Figma set (seven): seller awaiting shipment/deadline; submitted/pre-shipment; accepted/in-transit; exception/overdue; buyer delivered/inspection; dispute evidence/under review; approved return timeline.

No native module is inherent in this plan. Database/Edge Function and React UI work alone would not require Android/iOS native rebuild. A rebuild is required only if Phase 2 later adds a native SDK/capability; the recommended server HTTP adapter does not.

## 19. Admin Shipping Issues queue

Add read models for deadline expired, invalid/never accepted, provider-delayed, carrier exception, return required/overdue, delivery dispute, high-value review, destination mismatch, and reconciliation error. Filters include age/severity/carrier/state; details show immutable order/address summary, event timeline, evidence, financial holds, and audit.

Narrow operations only: retry provider lookup; approve pre-acceptance tracking correction; place/clear reasoned shipping hold; approve return/refund-without-return; resolve dispute through existing trusted policy-derived refund; acknowledge provider incident. No arbitrary order status, refund amount, payout amount, tracking event, or fabricated acceptance. Every operation checks active server-side staff role and writes `staff_action_log` with safe metadata.

## 20. Analytics

Server-derived events: `shipping_checkout_started` (checkout start may remain client funnel-only), `shipping_payment_confirmed`, `tracking_submitted`, `carrier_accepted`, `shipped_within_deadline`, `shipping_deadline_missed`, `unshipped_auto_cancelled`, `shipment_delivered`, `shipping_inspection_dispute`, `return_started`, and `return_completed`. Stable entity ID is order/return; metadata is allowlisted carrier/state/version only—no address, tracking number, provider raw data, or financial truth from client.

Metrics: percent accepted within three business days, median paid-to-acceptance, delivery-dispute rate, not-as-described rate, unshipped-cancellation rate, and seller compliance. Compute from authoritative tables, excluding test fixtures where tagged.

## 21. Security and authorization boundaries

The app may submit carrier/tracking, cancellation request, early acceptance, dispute text/evidence, and return tracking. It must never control acceptance, delivered state, deadline/timezone, provider events/destination match, refund amount, payout, dispute/return decision, financial status, or admin action.

- App → JWT-authenticated narrow Edge Function; reject extra fields and derive actor from token.
- Edge Function → service-only RPC; RPC rechecks actor/order role, fulfillment/payment version, and locks rows.
- Provider → signature-authenticated webhook; no JWT bypass as authority.
- Scheduler → service-secret invocation; bounded claims only.
- Staff → JWT plus active `staff_roles` server check, then narrow service RPC and audit.
- RLS: participants read minimized order/shipment/event/return records; clients receive no insert/update grants on trusted shipping tables; evidence paths scoped by actor/order/direction; provider IDs/raw events/staff notes remain service/staff only.
- Secrets never appear in client environment, logs, analytics, docs, or notification payloads.

## 22. Additive schema and migration plan

Do not implement yet. Suggested order:

1. **Shipping snapshots/deadlines:** nullable order address snapshot reference/encrypted fields, destination fingerprint, `ship_by_at`, IANA zone/source/version, shipping workflow version. Backfill none; legacy rows stay null/`legacy_manual`.
2. **Shipment hardening:** extend `order_shipments` with provider/tracker/normalized state/version/verified timestamps/correction fields; make old `shipped_at` legacy-compatible, not reinterpreted. Add append-only `shipment_events` and reuse index/override table.
3. **Trusted RPCs:** deadline calculator; submit/correct tracking; provider-event application; deadline claim/finalize; all service-only except narrow authenticated wrappers.
4. **Returns:** additive `order_returns` and `return_events`, one return/order, private evidence grants, payout/refund gates.
5. **Outbox/analytics/admin:** event constraints, reminder claims, server analytics allowlist, shipping issue view, staff operations/audit target types.
6. **Jobs:** bounded shipment reconciliation/reminder/deadline/return workers and schedules only after dry-run and runtime verification.

Do not remove old enum values immediately. New workflow uses shipment state as truth while mapping legacy `orders.fulfillment_status='shipped'` for old UI. Existing orders remain readable; null deadline/address/provider fields render “Legacy/manual verification.” Never claim historical seller-entered shipment was carrier-verified. Historical paid orders follow manual fallback and current financial invariants.

Proposed Edge Functions: `submit-shipment-tracking`, `shipping-provider-webhook`, `reconcile-shipments`, `process-shipping-deadlines`, `request-order-cancellation`, `submit-return-tracking`; extend `admin-operations` narrowly. Prefer shared service RPCs for state transitions and existing `process-order-refund`/financial reconciler for money movement.

## 23. Full implementation test plan

### Deadline

- Monday–Sunday cases, Friday/weekend, leap date, midnight boundary, seller zones, missing-zone fallback, spring/fall DST, holidays documented, client clock ignored, seller/client cannot edit, exactly overdue, idempotent calculation, legacy null.

### Tracking

- valid/invalid/unknown carrier; pre-shipment does not satisfy deadline; accepted does; reused carrier+number; recycled-number admin review; correction before acceptance; blocked after acceptance; old history retained; duplicate/stale/out-of-order webhook; wrong tracker/order/carrier; invalid HMAC/replay; polling/webhook same event; delivered never regresses.

### Cancellation/refund races

- overdue without acceptance; final fresh recheck; acceptance before/while scheduler claim; tracking just before deadline; provider outage; seller/buyer cancellation against acceptance; refund claim against late acceptance; full refund, no payout, no early relist; relist after settlement only; duplicate scheduler/function/webhook; Stripe ambiguous refund remains reconciling; reversal if invariant is historically violated.

### Delivery/inspection/disputes

- trusted delivered/duplicate/stale; fake client delivery rejected; carrier timestamp bounds; exact +48 hours; early accept; expiry/dispute race; INR for never accepted/RTS/failure/wrong destination/delivered/conflict; NAD evidence permissions/MIME/limits; seller evidence; payout frozen throughout.

### Returns

- authorized creation only; tracking pre-shipment/acceptance/in-transit/delivered; correction/reuse; overdue/exception; refund readiness; duplicate events/refund; refund-without-return admin-only; return state blocks payout.

### Payout/security/moderation

- no payout before trusted delivery and inspection; none during dispute/cancel/refund/return/provider uncertainty; payout after valid completion; duplicate transfer; suspended/deactivated buyer/seller and removed listing remain resolvable; client cannot forge any trusted field; provider/staff/service secrets absent from bundles/logs; inactive staff rejected; every admin correction audited.

### Pricing/address/notifications/analytics

- negative/fractional/over-cap shipping rejected; cents exact; item-only fee; checkout line visibility and tamper test; destination frozen after payment; profile/message cannot change it; privacy/RLS; each reminder/event emitted once; retries do not duplicate; metrics derive from authoritative rows.

Continue passing all current D1, D2, D3, D3.1, Phase E/F/G, hybrid local transactions, checkout reservation, payout/refund recovery, reviews, disputes, admin/security, deep-link, listing-history, secret-scan, TypeScript, ESLint, Expo Doctor, and full exploratory QA suites.

## 24. Readiness verdict and blockers

### Controlled private beta shipping: RED now

RED blockers before even controlled shipping is defensible: seller input equals shipped; buyer input equals delivered; no server deadline/final recheck/auto-refund worker; no protected destination snapshot; no provider verification/outage handling/reuse protection. After Phase 2 implements those, controlled beta can be **YELLOW** with manual return labels, staff-mediated conflicts, one package, holidays excluded, and incomplete destination proof clearly disclosed.

### Public shipping: RED

In addition to all beta blockers: destination proof remains carrier-dependent; return operations and policy are unproven; cancellation/high-value/signature/liability policies require approval; shipping-price ceiling and deceptive-charge operations are missing; provider SLA/security/credential coverage must be contracted; moderation/deletion and provider-outage runbooks need runtime validation; tax/legal/consumer-policy work remains outside this technical phase.

## 25. Product-policy decisions requiring approval

1. Buyer self-cancel cutoff and whether post-tracking requests need seller agreement or staff.
2. Seller cancellation consequences/compliance scoring.
3. Holiday handling beyond weekday-only V1 and fallback timezone.
4. Tracking correction count/lookback and reuse override authority.
5. Provider choice and required FedEx carrier credentials/commercial terms.
6. Provider outage grace/escalation window.
7. Destination mismatch evidence threshold; never promise universal proof.
8. Return eligibility, deadlines, buyer-remorse policy, shipping responsibility, reasonable-cost cap, and negative seller balance handling.
9. Damaged-in-transit responsibility and insurance disclaimer.
10. Signature/manual-review/value thresholds and risk delays.
11. Shipping price cap/ratio and exceptions.
12. Data retention for addresses, provider events, evidence, and signatures.

## 26. Exact recommended Phase 2 sequence

1. Approve the policies above and EasyPost-first/provider-neutral direction; verify terms and USPS/UPS/FedEx standalone coverage without committing credentials to source.
2. Implement/test business-calendar, frozen destination, deadline, and legacy compatibility schema/RPCs.
3. Implement provider-neutral domain and fake adapter contract tests before any real provider call.
4. Implement tracking submission/correction/reuse protection; seller submission remains non-shipped.
5. Add EasyPost HTTP adapter, signed webhook ingestion, event dedupe/history, monotonic transitions, and polling.
6. Add reminder/deadline claim and final-recheck worker; reuse current refund/reversal reconciliation; implement post-refund safe relisting.
7. Switch delivery/inspection to trusted events; retain audited manual beta fallback.
8. Add return state, evidence, cancellation requests, and payout gates.
9. Add narrow Shipping Issues admin queue/actions, analytics, monitoring, and operational runbooks.
10. Implement minimal seller/buyer UI states and seven reviewed mockups.
11. Run race/security/regression/runtime QA in development and Stripe test mode; clean temporary fixtures/helpers.
12. Reassess controlled-beta readiness. Public shipping remains separately gated.

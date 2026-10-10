# Phase D3 financial and cancellation policy

## Stripe processing costs

Marketplace V1 intentionally absorbs Stripe payment-processing costs. Seller
proceeds remain predictable and are calculated from trusted order snapshots:

```text
seller proceeds = item amount + shipping amount
                - marketplace fee amount
                - reserve withheld amount
```

All values are integer cents. The marketplace fee applies only to item price:
4% of the first $1,000, 2% above $1,000, with a $1 minimum for a non-zero item.
Tax and Stripe processing costs are not deducted from seller proceeds.

Under Separate Charges and Transfers the platform is the Stripe charge account,
so processing fees, non-returned fees after refunds, chargeback fees, and amounts
that cannot be recovered from a connected account are platform liabilities. This
reduces V1 seller/accounting complexity, but operations must monitor margin. For
a sale at or below $1,000 before shipping and tax, gross marketplace revenue is
4% of item price (minimum $1) and contribution before other costs is that fee
minus the actual Stripe processing cost. Above $1,000, incremental marketplace
revenue is 2%, which can be less than incremental processing cost; high-value
sales therefore require margin monitoring and may need a future explicit policy
decision without silently changing the marketplace fee.

## Payout holds

Fulfillment verification creates an eligibility timestamp, not an immediate
right to transfer. `payout_not_before` is calculated by the trusted database
from the seller's private payout-delay configuration. Restricted sellers remain
blocked. Shipping additionally requires the 48-hour inspection window to end or
the buyer to accept early, and every open internal or Stripe dispute/refund/
reversal reconciliation blocks payout.

## Cancellation policy

- Unpaid reservations may be cancelled and inventory may be reactivated.
- A paid buyer request is allowed only before pickup is ready/confirmed or a
  shipment is marked shipped. It initiates a trusted full-refund workflow.
- A seller may cancel a paid order only before pickup confirmation or shipment;
  the buyer receives a trusted full refund.
- After pickup confirmation, shipment, inspection start, or completion,
  ordinary cancellation is rejected. Problems use the dispute workflow.
- Listing reactivation occurs only after an unpaid cancellation or after the
  refund is authoritatively confirmed and no fulfillment evidence makes resale
  unsafe.

Refund amounts are never selected by either buyer or seller. V1 cancellation
uses a full remaining refundable amount. Partial refunds are a service-role-only
foundation pending moderator tooling and operational policy.

## Disputes and moderator operations

There is no secure moderator role in the current application. Buyers may open
eligible disputes and sellers may respond, but resolution, arbitrary partial
refunds, and financial overrides remain service-role/manual backend operations.
No ordinary client receives moderator authority.

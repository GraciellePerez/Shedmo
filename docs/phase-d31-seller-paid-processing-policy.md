# Phase D3.1 seller-paid processing policy

All amounts are integer cents. Buyer total remains item plus shipping; there is no buyer marketplace fee.

The authoritative processing cost is `BalanceTransaction.fee` from the successful platform Charge's expanded `balance_transaction`. Until that value is reconciled, seller payout is blocked.

Original seller proceeds are:

`max(0, item + shipping - marketplace fee - actual Stripe processing fee - reserve)`

For a settled partial refund before transfer, remaining entitlement is:

`max(0, original seller proceeds - total succeeded refunds)`

For a refund after transfer, the reversal is dollar-for-dollar up to the unreversed transfer balance. The original processing fee is never reduced merely because a refund occurs. Full cancellations waive the marketplace fee for V1 but create an idempotent seller liability equal to the non-returned actual processing fee. A partial refund beyond available same-order proceeds creates a residual liability.

Liabilities are never debited from an external bank account. They are reserved against later seller payout claims and settled only when that payout transfer succeeds. Pending refund, reversal, dispute, inspection, risk-delay, or processing-fee reconciliation continues to block payout.

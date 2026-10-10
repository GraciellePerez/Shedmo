# Public V1 local-only launch mode

Public V1 is intentionally local-only. Sellers publish pickup listings, buyers
message sellers, both parties arrange and inspect at a meetup, payment happens
directly outside Shedmo, and mutual confirmation enables transaction-gated
reviews.

## Default development behavior

All launch flags default to disabled when absent. A normal development bundle
therefore hides shipping and Protected Checkout and normalizes new listings to:

- `pickup_available = true`
- `shipping_available = false`
- `shipping_price = null`

The server independently rejects Protected Checkout, shipping fulfillment,
tracking, delivery, and EasyPost webhook behavior. Client flags are never the
authorization boundary.

## Controlled beta re-enable path

Shipping architecture remains preserved. A controlled beta requires all four
flags to be explicitly set to `true` in the intended non-production environment:

```text
EXPO_PUBLIC_ENABLE_PUBLIC_SHIPPING=true
EXPO_PUBLIC_ENABLE_PROTECTED_CHECKOUT=true
ENABLE_PUBLIC_SHIPPING=true
ENABLE_PROTECTED_CHECKOUT=true
```

The `EXPO_PUBLIC_` values are bundled into the client. The server values belong
only in Supabase Edge Function secrets/configuration. Never put server values or
provider credentials in client configuration.

Re-enabling requires a new client bundle/update and deployment of the already
preserved gated Edge Functions. It does not require changing migrations 037–039
or rebuilding native Android/iOS projects solely because of these TypeScript and
environment changes.

Before any controlled beta, separately verify migration state, TEST-mode payment
and carrier credentials, deployed function versions, webhook authentication, and
the full shipping runtime QA plan. Public V1 must leave all four flags absent or
false.

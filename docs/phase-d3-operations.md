# Phase D3 manual operations

Nothing in Phase D3 is deployed automatically.

## Migration

```powershell
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Review the generated plan before confirming. The only new migration is
`202608060018_add_phase_d3_financial_safety.sql`.

## Edge Functions

```powershell
npx supabase functions deploy complete-pickup-by-pin --project-ref YOUR_PROJECT_REF
npx supabase functions deploy accept-delivery --project-ref YOUR_PROJECT_REF
npx supabase functions deploy cancel-order --project-ref YOUR_PROJECT_REF
npx supabase functions deploy open-order-dispute --project-ref YOUR_PROJECT_REF
npx supabase functions deploy respond-order-dispute --project-ref YOUR_PROJECT_REF
npx supabase functions deploy process-order-refund --project-ref YOUR_PROJECT_REF --no-verify-jwt
npx supabase functions deploy reconcile-order-financials --project-ref YOUR_PROJECT_REF --no-verify-jwt
npx supabase functions deploy stripe-webhook --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

The two service-only functions disable gateway JWT verification because they
verify the exact service-role bearer credential themselves. Never call them
from the mobile app or place the service-role key in Expo configuration.

## Stripe test-mode webhook

Add these events to the existing signed test-mode webhook endpoint:

- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`
- `charge.refunded`
- `refund.updated`
- `transfer.reversed`

Keep the existing account and PaymentIntent events. Do not create a second
webhook secret unless a second endpoint is intentionally created.

## Scheduled reconciliation

Run `reconcile-order-financials` every five minutes. Supabase Cron plus Vault and
`pg_net` is the smallest mechanism consistent with the current architecture.
Store the project URL and service-role key in Vault; never put the key directly
in a migration or cron command committed to source control.

After replacing the placeholders interactively in the SQL editor:

```sql
select vault.create_secret('https://PROJECT_REF.supabase.co', 'phase_d3_project_url');
select vault.create_secret('SERVICE_ROLE_KEY', 'phase_d3_service_role_key');

select cron.schedule(
  'phase-d3-financial-reconciliation',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'phase_d3_project_url') ||
           '/functions/v1/reconcile-order-financials',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets
         where name = 'phase_d3_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

The worker expires at most 100 inspections and processes at most 50 due payouts,
50 reconciling transfers, 50 refunds, and 50 reversals per invocation.

## Moderator workflow

No moderator UI or ordinary-client moderator role exists. A trusted operator may
call `resolve_order_dispute_v1` with the service role. A buyer resolution creates
a durable refund claim. Pass that returned refund ID to the service-only
`process-order-refund` function. Seller/no-action resolutions restore eligibility
only through trusted payout-delay checks.

## Manual test plan

1. Generate pickup proof and verify QR and PIN share an expiry.
2. Enter four incorrect PINs; verify fulfillment/payout are unchanged. Enter a
   fifth; verify the proof locks. Regenerate and verify both old QR and PIN fail.
3. Complete pickup with the new PIN; verify `payout_not_before` reflects the
   private seller delay and no immediate transfer occurs.
4. Mark a shipping order delivered; verify the 48-hour server timestamp, early
   acceptance, automatic expiry, and dispute freeze.
5. Test full cancellation refund both before and after a test transfer. Retry
   the same requests and verify one Stripe Refund/Reversal only.
6. Simulate database-finalization failure after Stripe success, invoke the
   reconciler, and verify recovery by durable metadata/reference.
7. Exercise Stripe test disputes and verify open/freeze/won/lost transitions.

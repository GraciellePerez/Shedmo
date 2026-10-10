# Phase F private-beta admin operations

Phase F adds a server-authorized staff workspace without granting client access to staff roles, moderation state, financial tables, Stripe identifiers, or service credentials. Every mutation is performed by `admin-operations` through service-only database functions and produces one append-only audit record when state changes.

## Roles and safe limits

- Moderators may triage reports, resolve disputes through the existing D3 trusted resolution function, and hide/restore eligible listings.
- Admins may also suspend users, restrict selling, run the existing bounded financial reconciler, and inspect the audit trail.
- Suspension and selling restrictions block new selling/checkout activity but do not remove access to existing orders, refunds, disputes, or support.
- Sold or reserved listings cannot be hidden or restored by this tool because changing their lifecycle state could interfere with fulfillment and financial records. There is no permanent-delete action.
- Financial data is read-only. The only retry invokes the existing idempotent reconciler; the client cannot provide amounts, recipients, Stripe IDs, refund IDs, or transfer IDs.
- User search intentionally uses profile name/username only. Auth email search is deferred because exposing `auth.users` through this operational endpoint is unnecessary for the beta workflow.

## Manual migration and deployment

Do not deploy automatically. After reviewing migration history:

```powershell
supabase migration list --project-ref YOUR_PROJECT_REF
supabase db push --project-ref YOUR_PROJECT_REF
supabase functions deploy admin-operations --project-ref YOUR_PROJECT_REF
supabase functions deploy create-checkout-payment --project-ref YOUR_PROJECT_REF
```

If Phase E migration `202608060021_finalize_phase_e_marketplace_experience.sql` is still pending, it will precede Phase F migration `202608060022_add_phase_f_minimal_admin.sql`. Stop if local and remote migration history differ.

## Bootstrap the first admin manually

Run this once in the Supabase SQL editor, replacing the email with the intended staff account. This is deliberately not exposed in the app:

```sql
insert into public.staff_roles (user_id, role, active, created_by)
select id, 'admin', true, id
from auth.users
where lower(email) = lower('ADMIN_EMAIL_HERE')
on conflict (user_id) do update
set role = excluded.role, active = true;
```

Confirm exactly one row was affected. Subsequent role management remains a manual, trusted database operation for private beta.

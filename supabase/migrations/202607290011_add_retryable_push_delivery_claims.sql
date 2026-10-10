-- Add retry metadata without changing the potentially applied push-token migration.
alter table public.push_delivery_claims
  add column attempt_count integer not null default 0,
  add column last_attempt_at timestamptz,
  add column next_attempt_at timestamptz,
  add column last_error_code text,
  add column claim_token uuid,
  add constraint push_delivery_claims_attempt_count_check
    check (attempt_count >= 0);

create index push_delivery_claims_retry_idx
  on public.push_delivery_claims (next_attempt_at)
  where status = 'error' and next_attempt_at is not null;

-- Service-only atomic claim acquisition. An invocation may acquire a new claim,
-- a claim whose five-minute lease expired, or a retryable error whose backoff
-- has elapsed. Sent, delivered, and permanent errors cannot be reclaimed.
create or replace function public.acquire_push_delivery_claim(
  p_notification_id uuid,
  p_push_token_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_claim_token uuid := gen_random_uuid();
  acquired_claim_token uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;

  with acquired_claim as (
    insert into public.push_delivery_claims (
      notification_id,
      push_token_id,
      status,
      attempt_count,
      last_attempt_at,
      next_attempt_at,
      last_error_code,
      claim_token
    )
    values (
      p_notification_id,
      p_push_token_id,
      'claimed',
      1,
      now(),
      null,
      null,
      new_claim_token
    )
    on conflict (notification_id, push_token_id) do update
    set
      status = 'claimed',
      attempt_count = public.push_delivery_claims.attempt_count + 1,
      last_attempt_at = now(),
      next_attempt_at = null,
      last_error_code = null,
      claim_token = excluded.claim_token
    where (
      public.push_delivery_claims.status = 'claimed'
      and coalesce(
        public.push_delivery_claims.last_attempt_at,
        public.push_delivery_claims.created_at
      ) < now() - interval '5 minutes'
    ) or (
      public.push_delivery_claims.status = 'error'
      and public.push_delivery_claims.next_attempt_at is not null
      and public.push_delivery_claims.next_attempt_at <= now()
    )
    returning claim_token
  )
  select claim_token
  into acquired_claim_token
  from acquired_claim;

  return acquired_claim_token;
end;
$$;

revoke all on function public.acquire_push_delivery_claim(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.acquire_push_delivery_claim(uuid, uuid)
  to service_role;

comment on function public.acquire_push_delivery_claim(uuid, uuid) is
  'Atomically acquires a service-only push-delivery lease, including stale and backoff-eligible retries.';

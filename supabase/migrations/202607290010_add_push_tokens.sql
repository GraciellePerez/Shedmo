-- Private, multi-device Expo push token registry.
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  platform text not null,
  device_id text,
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint push_tokens_token_format check (
    expo_push_token ~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$'
    or expo_push_token ~ '^ExpoPushToken\[[A-Za-z0-9_-]+\]$'
  ),
  constraint push_tokens_platform_check check (platform in ('ios', 'android')),
  constraint push_tokens_token_unique unique (expo_push_token)
);

create index push_tokens_user_active_idx
  on public.push_tokens (user_id, last_seen_at desc)
  where disabled_at is null;

create trigger push_tokens_set_updated_at
before update on public.push_tokens
for each row execute function public.set_profiles_updated_at();

alter table public.push_tokens enable row level security;

create policy "Users read only their push tokens"
on public.push_tokens for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.push_tokens from public, anon;
revoke insert, update, delete on table public.push_tokens from authenticated;
grant select on table public.push_tokens to authenticated;

-- Registration is the only client-authorized mutation path. SECURITY DEFINER
-- permits inserting a new token or refreshing a token already owned by the
-- caller, without exposing or transferring another account's token row.
create or replace function public.register_push_token(
  p_expo_push_token text,
  p_platform text,
  p_device_id text default null,
  p_app_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  registered_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if p_expo_push_token is null or not (
    p_expo_push_token ~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$'
    or p_expo_push_token ~ '^ExpoPushToken\[[A-Za-z0-9_-]+\]$'
  ) then
    raise exception 'Invalid Expo push token';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'Invalid push platform';
  end if;

  insert into public.push_tokens (
    user_id, expo_push_token, platform, device_id, app_version,
    last_seen_at, updated_at, disabled_at
  )
  values (
    caller_id, p_expo_push_token, p_platform,
    nullif(btrim(p_device_id), ''), nullif(btrim(p_app_version), ''),
    now(), now(), null
  )
  on conflict (expo_push_token) do nothing
  returning id into registered_id;

  if registered_id is null then
    update public.push_tokens
    set
      platform = p_platform,
      device_id = nullif(btrim(p_device_id), ''),
      app_version = nullif(btrim(p_app_version), ''),
      last_seen_at = now(),
      updated_at = now(),
      disabled_at = null
    where expo_push_token = p_expo_push_token
      and user_id = caller_id
    returning id into registered_id;
  end if;

  if registered_id is null then
    raise exception 'Push token is already registered';
  end if;

  return registered_id;
end;
$$;

-- Unregistering affects only the supplied token when it currently belongs to
-- the authenticated caller. It cannot remove another device or account token.
create or replace function public.unregister_push_token(p_expo_push_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  removed_count integer;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if p_expo_push_token is null or not (
    p_expo_push_token ~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$'
    or p_expo_push_token ~ '^ExpoPushToken\[[A-Za-z0-9_-]+\]$'
  ) then
    raise exception 'Invalid Expo push token';
  end if;

  delete from public.push_tokens
  where expo_push_token = p_expo_push_token
    and user_id = caller_id;
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

revoke all on function public.register_push_token(text, text, text, text) from public, anon;
grant execute on function public.register_push_token(text, text, text, text) to authenticated;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

-- A trusted delivery claim prevents duplicate sends when a database webhook is retried.
create table public.push_delivery_claims (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  push_token_id uuid not null references public.push_tokens(id) on delete cascade,
  created_at timestamptz not null default now(),
  expo_ticket_id text unique,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'error', 'delivered')),
  checked_at timestamptz,
  primary key (notification_id, push_token_id)
);

alter table public.push_delivery_claims enable row level security;
revoke all on table public.push_delivery_claims from public, anon, authenticated;

comment on table public.push_tokens is
  'Private per-device Expo push tokens. RLS prevents cross-account token access.';
comment on table public.push_delivery_claims is
  'Service-role-only idempotency claims for database webhook retries.';
comment on function public.register_push_token(text, text, text, text) is
  'Registers a new Expo token or refreshes one already owned by the authenticated account and returns only its row ID.';
comment on function public.unregister_push_token(text) is
  'Deletes only the supplied Expo token when it belongs to the authenticated account.';

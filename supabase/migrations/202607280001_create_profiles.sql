-- Phase 2: authentication profile foundation.
-- This migration intentionally creates no listing, messaging, order, review,
-- favorite, payment, or storage tables.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  username text unique,
  bio text,
  avatar_url text,
  city text,
  state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null
    or (
      username = lower(username)
      and username ~ '^[a-z0-9_]{3,20}$'
    )
  ),
  constraint profiles_state_format check (
    state is null or state ~ '^[A-Z]{2}$'
  )
);

comment on table public.profiles is
  'Public marketplace identity data only. Private auth email addresses remain in auth.users.';

-- Keep updated_at accurate without trusting the client to supply it.
create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_profiles_updated_at();

-- Create one public profile for every new auth user. The UUID fallback makes a
-- collision-resistant username when signup metadata does not contain a valid one.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  if requested_username !~ '^[a-z0-9_]{3,20}$' then
    requested_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  insert into public.profiles (id, display_name, username)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    requested_username
  );

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

alter table public.profiles enable row level security;

-- Public seller identity is readable by signed-out and signed-in clients. The
-- table contains no email address or other private authentication field.
create policy "Public profiles are readable by everyone"
on public.profiles
for select
to anon, authenticated
using (true);

-- Authenticated clients may only create the profile row matching their auth UID.
-- Normal signup uses the trigger above; this policy supports safe recovery cases.
create policy "Users may insert only their own profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

-- Authenticated clients may update only their own row, and the WITH CHECK clause
-- prevents changing ownership to another user's UUID.
create policy "Users may update only their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

grant select on table public.profiles to anon, authenticated;
grant insert, update on table public.profiles to authenticated;

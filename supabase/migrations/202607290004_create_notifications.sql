-- Persistent in-app notifications generated only by trusted database events.
-- Apply after 202607290003_normalize_listing_description_constraint.sql.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  title text not null,
  body text not null,
  listing_id uuid references public.listings(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notifications_type_check check (type in ('new_message', 'listing_favorited')),
  constraint notifications_title_check check (char_length(btrim(title)) between 1 and 160),
  constraint notifications_body_check check (char_length(btrim(body)) between 1 and 500),
  constraint notifications_target_check check (
    (type = 'new_message' and conversation_id is not null and listing_id is not null)
    or (type = 'listing_favorited' and listing_id is not null)
  )
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index notifications_user_read_idx
  on public.notifications (user_id, is_read);
create index notifications_listing_idx on public.notifications (listing_id);
create index notifications_conversation_idx on public.notifications (conversation_id);

alter table public.notifications enable row level security;
alter table public.notifications replica identity full;

-- Users can read only notifications addressed to their authenticated profile.
create policy "Users read only their notifications"
on public.notifications for select to authenticated
using (user_id = auth.uid());

-- UPDATE is additionally restricted to the is_read column through column-level
-- grants. This policy restricts the affected row to its owner.
create policy "Users update read state on their notifications"
on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Users may permanently remove only their own notifications.
create policy "Users delete only their notifications"
on public.notifications for delete to authenticated
using (user_id = auth.uid());

-- No INSERT policy or INSERT grant exists for app clients. Notifications are
-- inserted only by the security-definer trigger functions below.
revoke all on table public.notifications from anon;
revoke insert, update on table public.notifications from authenticated;
grant select, delete on table public.notifications to authenticated;
grant update (is_read) on table public.notifications to authenticated;

create or replace function public.prevent_notification_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.user_id <> old.user_id
    or new.actor_id is distinct from old.actor_id
    or new.type <> old.type
    or new.title <> old.title
    or new.body <> old.body
    or new.listing_id is distinct from old.listing_id
    or new.conversation_id is distinct from old.conversation_id
    or new.created_at <> old.created_at
  then
    raise exception 'Only notification read state may be changed.';
  end if;
  return new;
end;
$$;

create trigger notifications_only_read_state_updates
before update on public.notifications
for each row execute function public.prevent_notification_identity_change();

create or replace function public.create_new_message_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  linked_listing_id uuid;
  actor_name text;
  listing_title text;
begin
  select
    case when new.sender_id = c.buyer_id then c.seller_id else c.buyer_id end,
    c.listing_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'A marketplace user'),
    l.title
  into recipient_id, linked_listing_id, actor_name, listing_title
  from public.conversations c
  join public.listings l on l.id = c.listing_id
  left join public.profiles p on p.id = new.sender_id
  where c.id = new.conversation_id
    and new.sender_id in (c.buyer_id, c.seller_id);

  if recipient_id is null or recipient_id = new.sender_id then
    return new;
  end if;

  insert into public.notifications (
    user_id, actor_id, type, title, body, listing_id, conversation_id
  )
  values (
    recipient_id,
    new.sender_id,
    'new_message',
    left('New message from ' || actor_name, 160),
    left('You have a new message about ' || listing_title || '.', 500),
    linked_listing_id,
    new.conversation_id
  );
  return new;
end;
$$;

create trigger messages_create_notification
after insert on public.messages
for each row execute function public.create_new_message_notification();

create or replace function public.create_listing_favorite_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  actor_name text;
  listing_title text;
begin
  select
    l.seller_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'A marketplace user'),
    l.title
  into recipient_id, actor_name, listing_title
  from public.listings l
  left join public.profiles p on p.id = new.user_id
  where l.id = new.listing_id;

  if recipient_id is null or recipient_id = new.user_id then
    return new;
  end if;

  -- Re-favoriting the same listing within ten minutes does not create another
  -- notification. The favorite table's composite key already handles rapid
  -- duplicate inserts that occur without an intervening removal.
  if exists (
    select 1 from public.notifications n
    where n.user_id = recipient_id
      and n.actor_id = new.user_id
      and n.listing_id = new.listing_id
      and n.type = 'listing_favorited'
      and n.created_at >= now() - interval '10 minutes'
  ) then
    return new;
  end if;

  insert into public.notifications (
    user_id, actor_id, type, title, body, listing_id
  )
  values (
    recipient_id,
    new.user_id,
    'listing_favorited',
    left(actor_name || ' saved your listing', 160),
    left(actor_name || ' saved ' || listing_title || '.', 500),
    new.listing_id
  );
  return new;
end;
$$;

create trigger favorites_create_notification
after insert on public.favorites
for each row execute function public.create_listing_favorite_notification();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

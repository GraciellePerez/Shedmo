-- Real marketplace conversations, text messages, read state, and scoped Realtime.
-- Apply after 202607290001_create_favorites.sql.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_buyer_is_not_seller check (buyer_id <> seller_id),
  constraint conversations_listing_participants_unique unique (listing_id, buyer_id, seller_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint messages_body_length check (
    char_length(btrim(body)) between 1 and 2000
  )
);

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index conversations_buyer_idx on public.conversations (buyer_id);
create index conversations_seller_idx on public.conversations (seller_id);
create index conversations_listing_idx on public.conversations (listing_id);
create index conversations_last_message_idx on public.conversations (last_message_at desc nulls last);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index messages_sender_idx on public.messages (sender_id);
create index conversation_reads_user_idx on public.conversation_reads (user_id);

create or replace function public.validate_conversation_participants()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  listing_seller uuid;
  listing_status text;
begin
  if tg_op = 'UPDATE' and (
    new.listing_id <> old.listing_id
    or new.buyer_id <> old.buyer_id
    or new.seller_id <> old.seller_id
  ) then
    raise exception 'Conversation participants and listing cannot be changed.';
  end if;

  select l.seller_id, l.status
  into listing_seller, listing_status
  from public.listings l
  where l.id = new.listing_id;

  if listing_seller is null then
    raise exception 'Listing does not exist.';
  end if;
  if new.seller_id <> listing_seller then
    raise exception 'Conversation seller must own the listing.';
  end if;
  if new.buyer_id = new.seller_id then
    raise exception 'A seller cannot message themselves as a buyer.';
  end if;
  if tg_op = 'INSERT' and listing_status <> 'active' then
    raise exception 'New conversations require an active listing.';
  end if;
  return new;
end;
$$;

create trigger conversations_validate_participants
before insert or update on public.conversations
for each row execute function public.validate_conversation_participants();

create or replace function public.validate_message_sender()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id
      and new.sender_id in (c.buyer_id, c.seller_id)
  ) then
    raise exception 'Message sender is not a conversation participant.';
  end if;
  return new;
end;
$$;

create trigger messages_validate_sender
before insert on public.messages
for each row execute function public.validate_message_sender();

create or replace function public.touch_conversation_after_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set last_message_at = new.created_at, updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation_after_message();

create or replace function public.prevent_conversation_read_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.conversation_id <> old.conversation_id or new.user_id <> old.user_id then
    raise exception 'Conversation read identity cannot be changed.';
  end if;
  return new;
end;
$$;

create trigger conversation_reads_immutable_identity
before update on public.conversation_reads
for each row execute function public.prevent_conversation_read_identity_change();

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;

-- Only either participant may read a conversation.
create policy "Participants read conversations"
on public.conversations for select to authenticated
using (auth.uid() in (buyer_id, seller_id));

-- Only a buyer may open a conversation for an active listing, with the seller
-- derived and verified against the listing owner by both policy and trigger.
create policy "Buyers create valid listing conversations"
on public.conversations for insert to authenticated
with check (
  buyer_id = auth.uid()
  and buyer_id <> seller_id
  and exists (
    select 1 from public.listings l
    where l.id = listing_id
      and l.status = 'active'
      and l.seller_id = seller_id
  )
);

-- No conversation UPDATE or DELETE policy is intentionally provided. The
-- message trigger alone updates timestamps through its security-definer function.

-- Messages are visible only to participants of their conversation.
create policy "Participants read messages"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
  )
);

-- A participant may send only as their own authenticated profile.
create policy "Participants send their own messages"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
  )
);

-- Message editing and deletion are disabled in this phase: no UPDATE or DELETE
-- policies are created, so participants cannot mutate message history.

-- A participant can read only their own read marker.
create policy "Participants read their own read markers"
on public.conversation_reads for select to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
  )
);

-- A participant can create only their own read marker.
create policy "Participants create their own read markers"
on public.conversation_reads for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
  )
);

-- A participant can update only their own marker; the trigger prevents changing
-- its conversation or user identity.
create policy "Participants update their own read markers"
on public.conversation_reads for update to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)
  )
);

-- Existing conversation participants retain read access to the listing and its
-- photos if it later becomes sold, archived, or expired. This does not permit
-- starting a new conversation for a non-active listing.
drop policy if exists "Read active owned or favorited sold listings"
on public.listings;

create policy "Read active owned favorited sold or conversation listings"
on public.listings for select
using (
  status = 'active'
  or seller_id = auth.uid()
  or (
    status = 'sold'
    and exists (
      select 1 from public.favorites f
      where f.listing_id = listings.id and f.user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.conversations c
    where c.listing_id = listings.id and auth.uid() in (c.buyer_id, c.seller_id)
  )
);

drop policy if exists "Read images for active owned or favorited sold listings"
on public.listing_images;

create policy "Read images for marketplace or conversation listings"
on public.listing_images for select
using (
  exists (
    select 1 from public.listings l
    where l.id = listing_id
      and (
        l.status = 'active'
        or l.seller_id = auth.uid()
        or (
          l.status = 'sold'
          and exists (
            select 1 from public.favorites f
            where f.listing_id = l.id and f.user_id = auth.uid()
          )
        )
        or exists (
          select 1 from public.conversations c
          where c.listing_id = l.id and auth.uid() in (c.buyer_id, c.seller_id)
        )
      )
  )
);

drop policy if exists "Read active owned or favorited sold listing photos"
on storage.objects;

create policy "Read marketplace or conversation listing photos"
on storage.objects for select
using (
  bucket_id = 'listing-images'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.listing_images li
      join public.listings l on l.id = li.listing_id
      where li.storage_path = name
        and (
          l.status = 'active'
          or l.seller_id = auth.uid()
          or (
            l.status = 'sold'
            and exists (
              select 1 from public.favorites f
              where f.listing_id = l.id and f.user_id = auth.uid()
            )
          )
          or exists (
            select 1 from public.conversations c
            where c.listing_id = l.id and auth.uid() in (c.buyer_id, c.seller_id)
          )
        )
    )
  )
);

create or replace function public.get_my_conversation_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id,
    count(m.id) filter (
      where m.sender_id <> auth.uid()
        and m.created_at > coalesce(cr.last_read_at, '-infinity'::timestamptz)
    ) as unread_count
  from public.conversations c
  left join public.conversation_reads cr
    on cr.conversation_id = c.id and cr.user_id = auth.uid()
  left join public.messages m on m.conversation_id = c.id
  where auth.uid() in (c.buyer_id, c.seller_id)
  group by c.id;
$$;

grant select, insert on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, update on public.conversation_reads to authenticated;
revoke execute on function public.get_my_conversation_unread_counts() from public, anon;
grant execute on function public.get_my_conversation_unread_counts() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end;
$$;

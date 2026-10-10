-- Private, participant-scoped image attachments for existing conversations.
-- Local only; do not apply remotely without the deployment approval.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880, array['image/jpeg'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.messages
  add column attachment_path text,
  add column attachment_mime_type text,
  add column attachment_size_bytes integer;

alter table public.messages drop constraint messages_body_length;
alter table public.messages add constraint messages_body_length check (
  (
    attachment_path is null
    and attachment_mime_type is null
    and attachment_size_bytes is null
    and char_length(btrim(body)) between 1 and 2000
  )
  or
  (
    attachment_path is not null
    and attachment_mime_type = 'image/jpeg'
    and attachment_size_bytes between 1 and 5242880
    and char_length(btrim(body)) <= 2000
  )
);
alter table public.messages add constraint messages_attachment_path_unique unique (attachment_path);
create index messages_attachment_path_idx on public.messages (attachment_path)
  where attachment_path is not null;

create table public.chat_image_upload_reservations (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint chat_image_upload_path_matches_identity check (
    storage_path = conversation_id::text || '/' || sender_id::text || '/' || id::text || '.jpg'
  )
);
create index chat_image_upload_reservations_expiry_idx
  on public.chat_image_upload_reservations (expires_at);
alter table public.chat_image_upload_reservations enable row level security;
revoke all on public.chat_image_upload_reservations from public, anon, authenticated, service_role;
grant select, delete on public.chat_image_upload_reservations to service_role;

-- Reported image bytes are retained privately even if an account deletion later
-- removes the conversation/message rows. Access is only through staff RPCs.
create table public.chat_attachment_report_evidence (
  report_id uuid primary key,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  captured_at timestamptz not null default clock_timestamp()
);
alter table public.chat_attachment_report_evidence enable row level security;
revoke all on public.chat_attachment_report_evidence from public, anon, authenticated, service_role;

create function public.chat_attachment_path_matches_v1(
  p_path text, p_conversation uuid, p_sender uuid, p_message uuid
) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select coalesce(
    p_path = p_conversation::text || '/' || p_sender::text || '/' || p_message::text || '.jpg'
    and position(chr(92) in p_path) = 0,
    false
  );
$$;
revoke all on function public.chat_attachment_path_matches_v1(text,uuid,uuid,uuid) from public, anon;
grant execute on function public.chat_attachment_path_matches_v1(text,uuid,uuid,uuid)
  to authenticated, service_role;

create function public.chat_image_upload_authorized_v1(p_path text)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_reservation public.chat_image_upload_reservations%rowtype;
begin
  if auth.uid() is null
    or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
    or exists (select 1 from public.account_deletion_state d where d.user_id = auth.uid())
    or exists (select 1 from auth.users u where u.id = auth.uid() and to_jsonb(u)->>'deleted_at' is not null)
  then return false; end if;
  select * into v_reservation from public.chat_image_upload_reservations
  where storage_path = p_path and sender_id = auth.uid() and expires_at > clock_timestamp();
  if not found then return false; end if;
  return exists (
    select 1 from public.conversations c
    where c.id = v_reservation.conversation_id
      and auth.uid() in (c.buyer_id, c.seller_id)
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_user_id = c.buyer_id and b.blocked_user_id = c.seller_id)
           or (b.blocker_user_id = c.seller_id and b.blocked_user_id = c.buyer_id)
      )
  );
end;
$$;
revoke all on function public.chat_image_upload_authorized_v1(text) from public, anon;
grant execute on function public.chat_image_upload_authorized_v1(text) to authenticated;

create function public.chat_image_read_authorized_v1(p_path text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.attachment_path = p_path
      and m.deleted_at is null
      and m.moderation_hidden_at is null
      and auth.uid() in (c.buyer_id, c.seller_id)
      and not exists (select 1 from public.account_deletion_state d where d.user_id = auth.uid())
      and not exists (select 1 from auth.users u where u.id = auth.uid() and to_jsonb(u)->>'deleted_at' is not null)
      and public.chat_attachment_path_matches_v1(p_path, m.conversation_id, m.sender_id, m.id)
  );
$$;
revoke all on function public.chat_image_read_authorized_v1(text) from public, anon;
grant execute on function public.chat_image_read_authorized_v1(text) to authenticated;

create function public.chat_image_cleanup_authorized_v1(p_path text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
    and split_part(p_path, '/', 2) = auth.uid()::text
    and not exists (select 1 from public.messages m where m.attachment_path = p_path)
    and not exists (
      select 1 from public.chat_attachment_report_evidence e
      where e.snapshot->>'attachment_path' = p_path
    );
$$;
revoke all on function public.chat_image_cleanup_authorized_v1(text) from public, anon;
grant execute on function public.chat_image_cleanup_authorized_v1(text) to authenticated;

create policy chat_images_participant_read on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-images' and public.chat_image_read_authorized_v1(name));
create policy chat_images_upload_reservation on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and owner_id = auth.uid()::text
    and public.chat_image_upload_authorized_v1(name)
  );
create policy chat_images_upload_cleanup on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-images'
    and owner_id = auth.uid()::text
    and public.chat_image_cleanup_authorized_v1(name)
  );

-- Restrictive checks ensure no other permissive storage policy can broaden
-- access to this bucket.
create policy chat_images_access_boundary on storage.objects
  as restrictive for select to authenticated
  using (bucket_id <> 'chat-images' or public.chat_image_read_authorized_v1(name));
create policy chat_images_upload_boundary on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'chat-images' or public.chat_image_upload_authorized_v1(name));
create policy chat_images_delete_boundary on storage.objects
  as restrictive for delete to authenticated
  using (
    bucket_id <> 'chat-images'
    or (
      owner_id = auth.uid()::text
    and public.chat_image_cleanup_authorized_v1(name)
    )
  );

create function public.guard_chat_image_message_v1()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_object storage.objects%rowtype; v_reservation public.chat_image_upload_reservations%rowtype;
begin
  if new.attachment_path is null then
    if new.attachment_mime_type is not null or new.attachment_size_bytes is not null then
      raise exception 'Invalid message attachment' using errcode = '22023';
    end if;
    return new;
  end if;
  if auth.uid() is null or auth.uid() <> new.sender_id
    or new.attachment_mime_type <> 'image/jpeg'
    or new.attachment_size_bytes not between 1 and 5242880
    or not public.chat_attachment_path_matches_v1(new.attachment_path, new.conversation_id, new.sender_id, new.id)
  then raise exception 'Invalid message attachment' using errcode = '42501'; end if;

  select * into v_reservation from public.chat_image_upload_reservations
  where id = new.id and conversation_id = new.conversation_id
    and sender_id = new.sender_id and storage_path = new.attachment_path
    and expires_at > clock_timestamp();
  if not found then raise exception 'Image upload is unavailable or expired' using errcode = '42501'; end if;

  select * into v_object from storage.objects
  where bucket_id = 'chat-images' and name = new.attachment_path;
  if not found or v_object.owner_id is distinct from new.sender_id::text
    or coalesce((v_object.metadata->>'mimetype'), '') <> 'image/jpeg'
    or coalesce((v_object.metadata->>'size')::integer, 0) <> new.attachment_size_bytes
  then raise exception 'Uploaded image is unavailable or invalid' using errcode = '22023'; end if;
  return new;
end;
$$;
revoke all on function public.guard_chat_image_message_v1() from public, anon, authenticated;
create trigger messages_guard_chat_image before insert on public.messages
  for each row execute function public.guard_chat_image_message_v1();

create function public.create_chat_image_upload_v1(p_conversation_id uuid, p_upload_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_conversation public.conversations%rowtype;
  v_reservation public.chat_image_upload_reservations%rowtype; v_message public.messages%rowtype;
  v_path text;
begin
  if v_actor is null or auth.role() <> 'authenticated' or p_conversation_id is null or p_upload_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found or v_actor not in (v_conversation.buyer_id, v_conversation.seller_id) then
    raise exception 'Conversation unavailable' using errcode = '42501';
  end if;
  if exists (select 1 from public.account_deletion_state d where d.user_id = v_actor)
    or exists (select 1 from auth.users u where u.id = v_actor and to_jsonb(u)->>'deleted_at' is not null) then
    raise exception 'Deleted account content cannot be restored' using errcode = '42501';
  end if;

  select * into v_message from public.messages
    where id = p_upload_id and conversation_id = p_conversation_id and sender_id = v_actor
      and attachment_path is not null;
  if found then
    return jsonb_build_object('upload_id', v_message.id, 'storage_path', v_message.attachment_path,
      'message_id', v_message.id, 'size_bytes', v_message.attachment_size_bytes);
  end if;

  perform public.lock_block_pair_v1(v_conversation.buyer_id, v_conversation.seller_id);
  if exists (select 1 from public.user_blocks b
    where (b.blocker_user_id = v_conversation.buyer_id and b.blocked_user_id = v_conversation.seller_id)
       or (b.blocker_user_id = v_conversation.seller_id and b.blocked_user_id = v_conversation.buyer_id)) then
    raise exception 'SHEDMO_INTERACTION_UNAVAILABLE' using errcode = 'P0001';
  end if;

  v_path := p_conversation_id::text || '/' || v_actor::text || '/' || p_upload_id::text || '.jpg';
  select * into v_reservation from public.chat_image_upload_reservations where id = p_upload_id;
  if found then
    if v_reservation.sender_id <> v_actor or v_reservation.conversation_id <> p_conversation_id then
      raise exception 'Image upload reservation unavailable' using errcode = '42501';
    end if;
    if v_reservation.expires_at <= clock_timestamp() then
      update public.chat_image_upload_reservations set expires_at = clock_timestamp() + interval '1 hour'
        where id = p_upload_id returning * into v_reservation;
    end if;
    return jsonb_build_object('upload_id', v_reservation.id, 'storage_path', v_reservation.storage_path);
  end if;
  insert into public.chat_image_upload_reservations(id, conversation_id, sender_id, storage_path, expires_at)
    values (p_upload_id, p_conversation_id, v_actor, v_path, clock_timestamp() + interval '1 hour');
  return jsonb_build_object('upload_id', p_upload_id, 'storage_path', v_path);
end;
$$;
revoke all on function public.create_chat_image_upload_v1(uuid,uuid) from public, anon;
grant execute on function public.create_chat_image_upload_v1(uuid,uuid) to authenticated;

create function public.send_chat_image_v1(p_upload_id uuid, p_caption text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_reservation public.chat_image_upload_reservations%rowtype;
  v_object storage.objects%rowtype; v_message public.messages%rowtype;
  v_size integer; v_caption text := nullif(btrim(p_caption), '');
begin
  if v_actor is null or auth.role() <> 'authenticated' or p_upload_id is null
    or char_length(coalesce(v_caption, '')) > 2000 then
    raise exception 'Invalid image message' using errcode = '22023';
  end if;
  select * into v_message from public.messages where id = p_upload_id and sender_id = v_actor
    and attachment_path is not null;
  if found then return to_jsonb(v_message); end if;

  select * into v_reservation from public.chat_image_upload_reservations
    where id = p_upload_id and sender_id = v_actor and expires_at > clock_timestamp();
  if not found then raise exception 'Image upload is unavailable or expired' using errcode = '42501'; end if;
  select * into v_object from storage.objects
    where bucket_id = 'chat-images' and name = v_reservation.storage_path;
  if not found or v_object.owner_id is distinct from v_actor::text
    or coalesce((v_object.metadata->>'mimetype'), '') <> 'image/jpeg' then
    raise exception 'Uploaded image is unavailable or invalid' using errcode = '22023';
  end if;
  v_size := coalesce((v_object.metadata->>'size')::integer, 0);
  if v_size not between 1 and 5242880 then
    raise exception 'Image must be 5 MB or smaller' using errcode = '22023';
  end if;

  insert into public.messages(
    id, conversation_id, sender_id, body, attachment_path, attachment_mime_type, attachment_size_bytes
  ) values (
    v_reservation.id, v_reservation.conversation_id, v_actor, coalesce(v_caption, ''),
    v_reservation.storage_path, 'image/jpeg', v_size
  ) returning * into v_message;
  delete from public.chat_image_upload_reservations where id = v_reservation.id;
  return to_jsonb(v_message);
end;
$$;
revoke all on function public.send_chat_image_v1(uuid,text) from public, anon;
grant execute on function public.send_chat_image_v1(uuid,text) to authenticated;

create function public.cancel_chat_image_upload_v1(p_upload_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or auth.role() <> 'authenticated' or p_upload_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  delete from public.chat_image_upload_reservations r
  where r.id = p_upload_id and r.sender_id = v_actor
    and not exists (select 1 from public.messages m where m.attachment_path = r.storage_path);
end;
$$;
revoke all on function public.cancel_chat_image_upload_v1(uuid) from public, anon;
grant execute on function public.cancel_chat_image_upload_v1(uuid) to authenticated;

create function public.preserve_chat_attachment_report_evidence_v1()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.report_type = 'message' then
    insert into public.chat_attachment_report_evidence(report_id, snapshot)
    select new.id, jsonb_build_object(
      'id', m.id, 'sender_id', m.sender_id, 'body', m.body, 'created_at', m.created_at,
      'conversation_id', c.id, 'listing_id', c.listing_id, 'listing_title', l.title,
      'attachment_path', m.attachment_path, 'attachment_mime_type', m.attachment_mime_type
    )
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    left join public.listings l on l.id = c.listing_id
    where m.id = new.target_id and m.conversation_id = new.conversation_id
      and m.attachment_path is not null
    on conflict (report_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_chat_attachment_report_evidence_v1() from public, anon, authenticated;
create trigger reports_preserve_chat_attachment_evidence after insert on public.reports
  for each row execute function public.preserve_chat_attachment_report_evidence_v1();

create or replace function public.ugc_report_content_v1(p_report uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_report public.reports%rowtype; v_content jsonb; v_snapshot jsonb;
begin
  select * into v_report from public.reports where id = p_report;
  if not found then raise exception 'Report unavailable'; end if;
  if v_report.report_type = 'listing' then
    select jsonb_build_object('id', l.id, 'seller_id', l.seller_id, 'title', l.title,
      'description', l.description, 'brand', l.brand, 'category', l.category,
      'status', l.status, 'created_at', l.created_at,
      'images', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'path', i.storage_path) order by i.sort_order, i.id)
        from public.listing_images i join storage.objects o on o.bucket_id = 'listing-images' and o.name = i.storage_path
        where i.listing_id = l.id and o.owner_id = l.seller_id::text
          and public.listing_image_path_matches_v1(i.storage_path, l.seller_id, l.id)), '[]'::jsonb))
    into v_content from public.listings l where l.id = v_report.target_id;
  elsif v_report.report_type = 'message' then
    select jsonb_build_object('id', m.id, 'sender_id', m.sender_id, 'body', m.body,
      'created_at', m.created_at, 'conversation_id', c.id, 'listing_id', c.listing_id,
      'listing_title', l.title, 'attachment_path', m.attachment_path,
      'attachment_mime_type', m.attachment_mime_type)
    into v_content from public.messages m
    join public.conversations c on c.id = m.conversation_id
    left join public.listings l on l.id = c.listing_id
    where m.id = v_report.target_id and m.conversation_id = v_report.conversation_id;
    if exists (select 1 from public.messages m where m.id = v_report.target_id and m.deleted_at is not null) then
      select snapshot into v_snapshot from public.chat_attachment_report_evidence
        where report_id = v_report.id;
      if v_snapshot is not null then return v_snapshot; end if;
    end if;
    if v_content is null then
      select snapshot into v_content from public.chat_attachment_report_evidence
        where report_id = v_report.id;
    end if;
  elsif v_report.report_type = 'review' then
    select jsonb_build_object('id', r.id, 'reviewer_id', r.reviewer_id,
      'reviewee_id', r.reviewee_id, 'body', r.body, 'rating', r.rating,
      'created_at', r.created_at, 'listing_id', v_report.listing_id)
    into v_content from public.marketplace_reviews r where r.id = v_report.target_id;
  elsif v_report.report_type = 'seller' then
    select jsonb_build_object('id', p.id, 'display_name', p.display_name,
      'username', p.username, 'bio', p.bio, 'avatar_url', p.avatar_url,
      'city', p.city, 'state', p.state, 'created_at', p.created_at)
    into v_content from public.profiles p where p.id = v_report.target_id;
  end if;
  return v_content;
end;
$$;
revoke all on function public.ugc_report_content_v1(uuid) from public, anon, authenticated, service_role;

commit;

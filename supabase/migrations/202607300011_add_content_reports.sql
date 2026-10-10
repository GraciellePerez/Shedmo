-- Private marketplace reports. Normal clients submit through the narrowly
-- scoped function below and receive no direct table access.

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  report_type text not null,
  target_id uuid not null,
  listing_id uuid references public.listings(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null, 
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_type_check check (
    report_type in ('listing', 'seller', 'message')
  ),
  constraint reports_status_check check (
    status in ('pending', 'under_review', 'resolved', 'dismissed')
  ),
  constraint reports_reason_check check (
    (report_type = 'listing' and reason in (
      'scam', 'prohibited_item', 'counterfeit', 'misleading',
      'duplicate', 'inappropriate', 'other'
    ))
    or
    (report_type = 'seller' and reason in (
      'scam', 'harassment', 'impersonation', 'suspicious_activity', 'other'
    ))
    or
    (report_type = 'message' and reason in (
      'harassment', 'spam', 'scam', 'inappropriate', 'other'
    ))
  ),
  constraint reports_details_check check (
    details is null
    or (
      details = btrim(details)
      and char_length(details) between 1 and 500
    )
  ),
  constraint reports_other_requires_details_check check (
    reason <> 'other' or details is not null
  ),
  constraint reports_review_state_check check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null and resolution_note is null)
    or
    (status = 'under_review' and resolution_note is null)
    or
    status in ('resolved', 'dismissed')
  ),
  constraint reports_target_shape_check check (
    (
      report_type = 'listing'
      and reported_user_id is null
      and conversation_id is null
      and message_id is null
      and (listing_id is null or listing_id = target_id)
    )
    or
    (
      report_type = 'seller'
      and listing_id is null
      and conversation_id is null
      and message_id is null
      and (reported_user_id is null or reported_user_id = target_id)
    )
    or
    (
      report_type = 'message'
      and listing_id is null
      and reported_user_id is null
      and (message_id is null or message_id = target_id)
    )
  )
);

comment on table public.reports is
  'Private abuse reports. target_id preserves the reported UUID if its nullable foreign-key target is later deleted.';
comment on column public.reports.resolution_note is
  'Internal moderation data; never exposed to authenticated marketplace clients.';

create index reports_reporter_created_idx
  on public.reports (reporter_id, created_at desc);
create index reports_status_created_idx
  on public.reports (status, created_at);
create index reports_listing_idx
  on public.reports (listing_id)
  where listing_id is not null;
create index reports_reported_user_idx
  on public.reports (reported_user_id)
  where reported_user_id is not null;
create index reports_conversation_idx
  on public.reports (conversation_id)
  where conversation_id is not null;
create index reports_message_idx
  on public.reports (message_id)
  where message_id is not null;

-- A resolved or dismissed report does not prevent a later report. This unique
-- index also closes races between rapid or concurrent submissions.
create unique index reports_one_open_target_per_reporter_idx
  on public.reports (reporter_id, report_type, target_id)
  where status in ('pending', 'under_review');

create or replace function public.validate_report_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_owner_id uuid;
  target_conversation_id uuid;
begin
  if new.report_type = 'listing' then
    if new.listing_id is null
      or new.listing_id <> new.target_id
      or new.reported_user_id is not null
      or new.conversation_id is not null
      or new.message_id is not null
    then
      raise check_violation using message = 'Invalid report target.';
    end if;

    select l.seller_id into target_owner_id
    from public.listings l
    where l.id = new.listing_id;
  elsif new.report_type = 'seller' then
    if new.reported_user_id is null
      or new.reported_user_id <> new.target_id
      or new.listing_id is not null
      or new.conversation_id is not null
      or new.message_id is not null
    then
      raise check_violation using message = 'Invalid report target.';
    end if;

    select p.id into target_owner_id
    from public.profiles p
    where p.id = new.reported_user_id;
  elsif new.report_type = 'message' then
    if new.message_id is null
      or new.message_id <> new.target_id
      or new.conversation_id is null
      or new.listing_id is not null
      or new.reported_user_id is not null
    then
      raise check_violation using message = 'Invalid report target.';
    end if;

    select m.sender_id, m.conversation_id
    into target_owner_id, target_conversation_id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = new.message_id
      and m.conversation_id = new.conversation_id
      and new.reporter_id in (c.buyer_id, c.seller_id);

    if target_conversation_id is null then
      raise check_violation using message = 'Invalid report target.';
    end if;
  else
    raise check_violation using message = 'Invalid report target.';
  end if;

  if target_owner_id is null or target_owner_id = new.reporter_id then
    raise check_violation using message = 'Invalid report target.';
  end if;

  return new;
end;
$$;

create trigger reports_validate_submission
before insert on public.reports
for each row execute function public.validate_report_submission();

create or replace function public.set_reports_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.set_reports_updated_at();

alter table public.reports enable row level security;

-- No client table policies are intentional. Reports and internal review fields
-- remain inaccessible even to their submitters; submission is through the
-- function below. Moderation is limited to Dashboard/database-owner or trusted
-- service-role tooling until a secure application role system exists.
revoke all on table public.reports from anon, authenticated;
grant select, insert, update on table public.reports to service_role;

create or replace function public.submit_content_report(
  p_report_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default null,
  p_conversation_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_details text := nullif(btrim(p_details), '');
  target_owner_id uuid;
  target_conversation_id uuid;
begin
  if auth.role() <> 'authenticated' then
    raise insufficient_privilege using message = 'Authentication required.';
  end if;

  if current_user_id is null then
    raise insufficient_privilege using message = 'Authentication required.';
  end if;

  if p_report_type is null
    or p_report_type not in ('listing', 'seller', 'message')
    or p_target_id is null
    or p_reason is null
    or char_length(coalesce(normalized_details, '')) > 500
    or (p_reason = 'other' and normalized_details is null)
  then
    return 'invalid_input';
  end if;

  if p_report_type = 'listing' then
    if p_conversation_id is not null
      or p_reason not in (
        'scam', 'prohibited_item', 'counterfeit', 'misleading',
        'duplicate', 'inappropriate', 'other'
      )
    then
      return 'invalid_input';
    end if;

    select l.seller_id
    into target_owner_id
    from public.listings l
    where l.id = p_target_id;

    if target_owner_id is null then
      return 'unavailable';
    end if;
    if target_owner_id = current_user_id then
      return 'invalid_target';
    end if;

    begin
      insert into public.reports (
        reporter_id, report_type, target_id, listing_id, reason, details
      )
      values (
        current_user_id, 'listing', p_target_id, p_target_id, p_reason, normalized_details
      );
    exception when unique_violation then
      return 'duplicate';
    end;
  elsif p_report_type = 'seller' then
    if p_conversation_id is not null
      or p_reason not in (
        'scam', 'harassment', 'impersonation', 'suspicious_activity', 'other'
      )
    then
      return 'invalid_input';
    end if;

    select p.id
    into target_owner_id
    from public.profiles p
    where p.id = p_target_id;

    if target_owner_id is null then
      return 'unavailable';
    end if;
    if target_owner_id = current_user_id then
      return 'invalid_target';
    end if;

    begin
      insert into public.reports (
        reporter_id, report_type, target_id, reported_user_id, reason, details
      )
      values (
        current_user_id, 'seller', p_target_id, p_target_id, p_reason, normalized_details
      );
    exception when unique_violation then
      return 'duplicate';
    end;
  else
    if p_conversation_id is null
      or p_reason not in ('harassment', 'spam', 'scam', 'inappropriate', 'other')
    then
      return 'invalid_input';
    end if;

    select m.sender_id, m.conversation_id
    into target_owner_id, target_conversation_id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = p_target_id
      and m.conversation_id = p_conversation_id
      and current_user_id in (c.buyer_id, c.seller_id);

    if target_owner_id is null or target_conversation_id is null then
      return 'unavailable';
    end if;
    if target_owner_id = current_user_id then
      return 'invalid_target';
    end if;

    begin
      insert into public.reports (
        reporter_id, report_type, target_id, conversation_id, message_id,
        reason, details
      )
      values (
        current_user_id, 'message', p_target_id, target_conversation_id,
        p_target_id, p_reason, normalized_details
      );
    exception when unique_violation then
      return 'duplicate';
    end;
  end if;

  return 'submitted';
end;
$$;

revoke all on function public.submit_content_report(text, uuid, text, text, uuid)
  from public, anon;
grant execute on function public.submit_content_report(text, uuid, text, text, uuid)
  to authenticated;

-- Corrects 047 without rewriting migration history. Local only; separate approval required.
begin;

-- Permanent private tombstones, deliberately not cascaded with auth/profile deletion.
create table public.account_deletion_state (
  user_id uuid primary key,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.account_deletion_state enable row level security;
revoke all on public.account_deletion_state from public,anon,authenticated,service_role;
-- Existing completed soft deletions use Supabase Auth's private durable state.
insert into public.account_deletion_state(user_id)
  select u.id from auth.users u where to_jsonb(u)->>'deleted_at' is not null;

create function public.record_account_deletion_v1(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then
    raise exception 'Service authorization required' using errcode='42501';
  end if;
  -- Serialize with restores, before any anonymization requests are issued.
  perform 1 from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Account unavailable'; end if;
  insert into public.account_deletion_state(user_id) values(p_user_id) on conflict do nothing;
end $$;
revoke all on function public.record_account_deletion_v1(uuid) from public,anon,authenticated;
grant execute on function public.record_account_deletion_v1(uuid) to service_role;

create function public.assert_account_content_restorable_v1(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where id=p_user_id for update;
  if exists(select 1 from public.account_deletion_state where user_id=p_user_id)
    or exists(select 1 from auth.users u where u.id=p_user_id and to_jsonb(u)->>'deleted_at' is not null) then
    raise exception 'Deleted account content cannot be restored' using errcode='42501';
  end if;
end $$;
revoke all on function public.assert_account_content_restorable_v1(uuid) from public,anon,authenticated,service_role;

-- Defense in depth for direct writes, including stale authenticated sessions.
-- Service cleanup and suppression remain possible; evidence cannot be republished.
create function public.guard_deleted_account_content_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  if tg_table_name='profiles' then v_owner:=new.id;
  elsif tg_table_name='listings' then v_owner:=new.seller_id;
  elsif tg_table_name='messages' then v_owner:=new.sender_id;
  else v_owner:=new.reviewer_id; end if;
  perform 1 from public.profiles where id=v_owner for update;
  if not exists(select 1 from public.account_deletion_state where user_id=v_owner)
    and not exists(select 1 from auth.users u where u.id=v_owner and to_jsonb(u)->>'deleted_at' is not null) then return new; end if;
  if auth.role() is distinct from 'service_role' or tg_op='INSERT' then
    raise exception 'Deleted account content cannot be restored' using errcode='42501';
  end if;
  if old.moderation_hidden_at is not null and new.moderation_hidden_at is null then
    raise exception 'Deleted account content cannot be restored' using errcode='42501';
  end if;
  if tg_table_name='marketplace_reviews' then
    if new.body is not null then raise exception 'Deleted account content cannot be restored' using errcode='42501'; end if;
  elsif tg_table_name='messages' then
    if new.body not in ('Message removed after account deletion.','[Message removed by Shedmo]') then
      raise exception 'Deleted account content cannot be restored' using errcode='42501'; end if;
  elsif tg_table_name='profiles' then
    if new.bio is not null or new.avatar_url is not null or new.city is not null or new.state is not null
      or new.display_name not in ('Deleted member','Shedmo member')
      or (new.username is not null and new.username <> 'deleted_'||substr(replace(new.id::text,'-',''),1,12)) then
      raise exception 'Deleted account content cannot be restored' using errcode='42501'; end if;
  elsif tg_table_name='listings' then
    if new.description is distinct from old.description and new.description is distinct from 'Removed after account deletion.' then
      raise exception 'Deleted account content cannot be restored' using errcode='42501'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_deleted_account_content_v1() from public,anon,authenticated,service_role;
create trigger profiles_deleted_content_guard before insert or update on public.profiles for each row execute function public.guard_deleted_account_content_v1();
create trigger listings_deleted_content_guard before insert or update on public.listings for each row execute function public.guard_deleted_account_content_v1();
create trigger messages_deleted_content_guard before insert or update on public.messages for each row execute function public.guard_deleted_account_content_v1();
create trigger reviews_deleted_content_guard before insert or update on public.marketplace_reviews for each row execute function public.guard_deleted_account_content_v1();

create or replace function public.staff_suppress_report_content_v1(p_staff_id uuid,p_report_id uuid,p_action text,p_note text,p_revision text)
returns text language plpgsql security definer set search_path='' as $$
declare v_report public.reports%rowtype; v_content jsonb; v_evidence public.ugc_moderation_evidence%rowtype; v_outcome text;
begin
  perform public.phase_f_staff_role(p_staff_id,false);
  if p_action is null or p_action not in ('suppress','restore') or char_length(btrim(coalesce(p_note,''))) not between 3 and 500 then
    raise exception 'Action and moderation note required' using errcode='22023'; end if;
  select * into v_report from public.reports where id=p_report_id for update;
  if not found then raise exception 'Report unavailable'; end if;
  -- Serialize staff decisions for multiple reports about the same content.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_report.report_type||v_report.target_id::text,0));
  if v_report.report_type='listing' then perform 1 from public.listings where id=v_report.target_id for update;
  elsif v_report.report_type='message' then perform 1 from public.messages where id=v_report.target_id for update;
  elsif v_report.report_type='review' then perform 1 from public.marketplace_reviews where id=v_report.target_id for update;
  else perform 1 from public.profiles where id=v_report.target_id for update; end if;
  v_content:=public.ugc_report_content_v1(p_report_id);
  if v_content is null then raise exception 'Reported content is no longer available'; end if;
  if p_action='restore' then
    perform public.assert_account_content_restorable_v1((case v_report.report_type
      when 'listing' then v_content->>'seller_id' when 'message' then v_content->>'sender_id'
      when 'review' then v_content->>'reviewer_id' else v_content->>'id' end)::uuid);
  end if;
  if p_revision is distinct from md5(v_content::text) then raise exception 'Content changed; inspect again' using errcode='40001'; end if;
  select * into v_evidence from public.ugc_moderation_evidence
    where target_type=v_report.report_type and target_id=v_report.target_id order by active desc,captured_at desc,id desc limit 1 for update;
  if p_action='suppress' and coalesce(v_evidence.active,false) then v_outcome:='already_suppressed';
  elsif p_action='restore' and not coalesce(v_evidence.active,false) then v_outcome:='already_visible';
  elsif p_action='suppress' then
    insert into public.ugc_moderation_evidence(target_type,target_id,report_id,snapshot)
      values(v_report.report_type,v_report.target_id,p_report_id,v_content);
    if v_report.report_type='listing' then
      -- Visibility is independent of transaction status, including sold/reserved records.
      update public.listings set moderation_hidden_at=now(),moderation_hidden_by=p_staff_id,
        moderation_reason=btrim(p_note),moderation_prior_status=status where id=v_report.target_id;
    elsif v_report.report_type='message' then
      update public.messages set body='[Message removed by Shedmo]',moderation_hidden_at=now() where id=v_report.target_id;
    elsif v_report.report_type='review' then
      update public.marketplace_reviews set body=null,moderation_hidden_at=now() where id=v_report.target_id;
    else
      update public.profiles set display_name='Shedmo member',username=null,bio=null,avatar_url=null,city=null,state=null,
        moderation_hidden_at=now() where id=v_report.target_id;
    end if;
    v_outcome:='suppressed';
  else
    if v_report.report_type='listing' then
      if public.ugc_text_is_prohibited_v1(concat_ws(' ',v_content->>'title',v_content->>'description',v_content->>'brand',v_content->>'category')) then
        raise exception 'SHEDMO_CONTENT_NOT_ALLOWED' using errcode='P0001';
      end if;
      update public.listings set moderation_hidden_at=null,moderation_hidden_by=null,moderation_reason=null,
        moderation_prior_status=null where id=v_report.target_id;
    elsif v_report.report_type='message' then
      update public.messages set body=v_evidence.snapshot->>'body',moderation_hidden_at=null where id=v_report.target_id;
    elsif v_report.report_type='review' then
      update public.marketplace_reviews set body=v_evidence.snapshot->>'body',moderation_hidden_at=null where id=v_report.target_id;
    else
      update public.profiles set display_name=v_evidence.snapshot->>'display_name',username=v_evidence.snapshot->>'username',
        bio=v_evidence.snapshot->>'bio',avatar_url=v_evidence.snapshot->>'avatar_url',city=v_evidence.snapshot->>'city',
        state=v_evidence.snapshot->>'state',moderation_hidden_at=null where id=v_report.target_id;
    end if;
    -- Existing 046 checks still apply to restored text. Failure rolls back the whole action.
    update public.ugc_moderation_evidence set active=false where id=v_evidence.id;
    v_outcome:='restored';
  end if;
  insert into public.staff_action_log(staff_user_id,action_type,target_type,target_id,safe_metadata)
    values(p_staff_id,'ugc_'||p_action,'report',p_report_id,jsonb_build_object('outcome',v_outcome,'note',btrim(p_note),'content_type',v_report.report_type,'content_id',v_report.target_id));
  return v_outcome;
end $$;
revoke all on function public.staff_suppress_report_content_v1(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.staff_suppress_report_content_v1(uuid,uuid,text,text,text) to service_role;
create or replace function public.staff_moderate_listing_v1(p_staff_id uuid,p_listing_id uuid,p_action text,p_reason text default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_listing public.listings%rowtype; v_changed boolean:=false;
begin
  perform public.phase_f_staff_role(p_staff_id,false);
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'Listing unavailable'; end if;
  if p_action='restore' then perform public.assert_account_content_restorable_v1(v_listing.seller_id); end if;
  if exists(select 1 from public.ugc_moderation_evidence where target_type='listing' and target_id=p_listing_id and active) then
    raise exception 'Use the associated report inspection to moderate this listing';
  end if;
  if p_action='hide' then
    if v_listing.status in ('sold','reserved') then raise exception 'Sold or reserved listings cannot be hidden'; end if;
    if v_listing.moderation_hidden_at is null then
      update public.listings set moderation_hidden_at=now(),moderation_hidden_by=p_staff_id,moderation_reason=left(nullif(btrim(p_reason),''),500),moderation_prior_status=status,status='archived' where id=p_listing_id;
      v_changed:=true;
    end if;
  elsif p_action='restore' then
    if v_listing.moderation_hidden_at is not null then
      update public.listings set status=case when moderation_prior_status in ('active','draft') then moderation_prior_status else 'draft' end,moderation_hidden_at=null,moderation_hidden_by=null,moderation_reason=null,moderation_prior_status=null where id=p_listing_id;
      v_changed:=true;
    end if;
  else raise exception 'Invalid action'; end if;
  if v_changed then insert into public.staff_action_log(staff_user_id,action_type,target_type,target_id) values(p_staff_id,'listing_'||p_action,'listing',p_listing_id); end if;
  return p_action;
end $$;

commit;

-- Local only; requires separate approval. No backfill or remote application.
-- Extends reporting and content moderation. Does not enforce account suspension.
begin;

create table public.ugc_moderation_evidence (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check(target_type in ('listing','seller','message','review')),
  target_id uuid not null,
  report_id uuid not null references public.reports(id) on delete restrict,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  active boolean not null default true,
  captured_at timestamptz not null default clock_timestamp()
);
create unique index ugc_one_active_evidence on public.ugc_moderation_evidence(target_type,target_id) where active;
alter table public.ugc_moderation_evidence enable row level security;
revoke all on public.ugc_moderation_evidence from public,anon,authenticated,service_role;
-- Access is exclusively through report-scoped, staff-authorized definer functions.

alter table public.marketplace_reviews add column moderation_hidden_at timestamptz;
alter table public.messages add column moderation_hidden_at timestamptz;
alter table public.profiles add column moderation_hidden_at timestamptz;
-- 045's public column allowlist does not expose the new profile moderation flag.

alter table public.reports add column review_id uuid references public.marketplace_reviews(id) on delete set null;
alter table public.reports drop constraint reports_type_check;
alter table public.reports add constraint reports_type_check check (report_type in ('listing','seller','message','review'));
alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check check (
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

 or (report_type='review' and reason in ('harassment','spam','scam','inappropriate','other')));
alter table public.reports drop constraint reports_target_shape_check;
alter table public.reports add constraint reports_target_shape_check check ((
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
  ) and review_id is null
 or (report_type='review' and review_id=target_id and listing_id is not null and reported_user_id is not null and conversation_id is null and message_id is null));
create or replace function public.validate_report_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_owner_id uuid;
  target_conversation_id uuid;
begin
  if new.report_type = 'review' then
    select r.reviewer_id into target_owner_id
    from public.marketplace_reviews r
    left join public.orders o on o.id=r.order_id
    left join public.local_sale_confirmations s on s.id=r.local_sale_confirmation_id
    where r.id=new.review_id and r.id=new.target_id
      and r.moderation_hidden_at is null
      and coalesce(o.listing_id,s.listing_id)=new.listing_id
      and r.reviewer_id=new.reported_user_id;
  elsif new.report_type = 'listing' then
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


create function public.submit_review_report_v1(p_review_id uuid,p_reason text,p_details text default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_reviewer uuid; v_listing uuid; v_details text:=nullif(btrim(p_details),'');
begin
  if v_actor is null or auth.role()<>'authenticated' then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_review_id is null or p_reason is null or p_reason not in ('harassment','spam','scam','inappropriate','other')
    or char_length(coalesce(v_details,''))>500 or (p_reason='other' and v_details is null) then return 'invalid_input'; end if;
  select r.reviewer_id,coalesce(o.listing_id,s.listing_id) into v_reviewer,v_listing
  from public.marketplace_reviews r left join public.orders o on o.id=r.order_id
  left join public.local_sale_confirmations s on s.id=r.local_sale_confirmation_id
  where r.id=p_review_id and r.moderation_hidden_at is null;
  if v_reviewer is null or v_listing is null then return 'unavailable'; end if;
  if v_reviewer=v_actor then return 'invalid_target'; end if;
  insert into public.reports(reporter_id,report_type,target_id,review_id,listing_id,reported_user_id,reason,details)
    values(v_actor,'review',p_review_id,p_review_id,v_listing,v_reviewer,p_reason,v_details);
  return 'submitted';
exception when unique_violation then return 'duplicate';
end $$;
revoke all on function public.submit_review_report_v1(uuid,text,text) from public,anon;
grant execute on function public.submit_review_report_v1(uuid,text,text) to authenticated;

create function public.ugc_listing_visible_v1(p_listing uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.listings where id=p_listing and moderation_hidden_at is null);
$$;
revoke all on function public.ugc_listing_visible_v1(uuid) from public;
grant execute on function public.ugc_listing_visible_v1(uuid) to anon,authenticated,service_role;
create policy listings_moderation_visibility on public.listings as restrictive for select to anon,authenticated
  using(moderation_hidden_at is null);
create policy listing_images_moderation_visibility on public.listing_images as restrictive for select to anon,authenticated
  using(public.ugc_listing_visible_v1(listing_id));
create policy reviews_moderation_visibility on public.marketplace_reviews as restrictive for select to anon,authenticated
  using(moderation_hidden_at is null);

create function public.ugc_storage_access_v1(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select case when p_bucket='listing-images' then not exists(
    select 1 from public.listings l where l.id::text=split_part(p_name,'/',2) and l.moderation_hidden_at is not null)
    when p_bucket='profile-avatars' then not exists(
      select 1 from public.profiles p where p.id::text=split_part(p_name,'/',1) and p.moderation_hidden_at is not null)
    else true end;
$$;
revoke all on function public.ugc_storage_access_v1(text,text) from public;
grant execute on function public.ugc_storage_access_v1(text,text) to anon,authenticated,service_role;
-- ANDs with 044 and all existing owner/history policies; cannot broaden access.
create policy storage_moderation_access on storage.objects as restrictive for all to anon,authenticated
  using(public.ugc_storage_access_v1(bucket_id,name))
  with check(public.ugc_storage_access_v1(bucket_id,name));
-- Public avatar GETs and previously issued signed URLs bypass a new RLS decision.
-- Those storage/cache limitations are documented; this policy does not revoke tokens.

create function public.guard_ugc_moderation_fields_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.role()='service_role' then return new; end if;
  if tg_op='INSERT' then
    if new.moderation_hidden_at is not null then raise exception 'Staff-managed fields cannot be changed' using errcode='42501'; end if;
  else
    if new.moderation_hidden_at is distinct from old.moderation_hidden_at then raise exception 'Staff-managed fields cannot be changed' using errcode='42501'; end if;
    if old.moderation_hidden_at is not null then
      if tg_table_name='profiles' then
        if (new.display_name,new.username,new.bio,new.avatar_url,new.city,new.state) is distinct from
          (old.display_name,old.username,old.bio,old.avatar_url,old.city,old.state) then
          raise exception 'Public profile content is awaiting staff review' using errcode='42501';
        end if;
      elsif tg_table_name in ('messages','marketplace_reviews') and new.body is distinct from old.body then
        raise exception 'Content is awaiting staff review' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_ugc_moderation_fields_v1() from public,anon,authenticated;
create trigger profiles_guard_ugc_moderation before insert or update on public.profiles for each row execute function public.guard_ugc_moderation_fields_v1();
create trigger messages_guard_ugc_moderation before insert or update on public.messages for each row execute function public.guard_ugc_moderation_fields_v1();
create trigger reviews_guard_ugc_moderation before insert or update on public.marketplace_reviews for each row execute function public.guard_ugc_moderation_fields_v1();
create or replace function public.get_profile_reviews(p_profile_id uuid, p_limit integer default 30, p_offset integer default 0)
returns table (
  review_id uuid, reviewer_id uuid, reviewer_name text, reviewer_avatar_url text,
  direction text, rating smallint, body text, created_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select r.id, r.reviewer_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Marketplace member'),
    p.avatar_url, r.direction, r.rating, r.body, r.created_at
  from public.marketplace_reviews r
  join public.profiles p on p.id = r.reviewer_id
  where r.reviewee_id = p_profile_id and r.moderation_hidden_at is null
  order by r.created_at desc, r.id desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;

create or replace function public.get_public_seller_profile_v2(p_seller_id uuid)
returns table (
  seller_id uuid, display_name text, username text, avatar_url text, bio text,
  city text, state text, member_since timestamptz, active_listing_count bigint,
  sold_listing_count bigint, verified_sales_count bigint, average_rating numeric, total_reviews bigint
)
language sql security definer set search_path = '' stable as $$
  select p.id, p.display_name, p.username, p.avatar_url, p.bio, p.city, p.state, p.created_at,
    (select count(*) from public.listings l where l.seller_id = p.id and l.status = 'active' and l.moderation_hidden_at is null),
    (select count(*) from public.listings l where l.seller_id = p.id and l.status = 'sold' and l.moderation_hidden_at is null),
    (select count(*) from public.orders o where o.seller_id = p.id and o.fulfillment_status = 'completed' and o.completed_at is not null)
      + (select count(*) from public.local_sale_confirmations s where s.seller_id = p.id and s.status = 'confirmed'),
    (select round(avg(r.rating)::numeric, 2) from public.marketplace_reviews r where r.reviewee_id = p.id and r.direction = 'buyer_to_seller' and r.moderation_hidden_at is null),
    (select count(*) from public.marketplace_reviews r where r.reviewee_id = p.id and r.direction = 'buyer_to_seller' and r.moderation_hidden_at is null)
  from public.profiles p where p.id = p_seller_id;
$$;

-- Private, allowlisted snapshots; never expose auth metadata, postal codes, or whole conversations.
revoke all on function public.get_profile_reviews(uuid,integer,integer),public.get_public_seller_profile_v2(uuid) from public,anon;
grant execute on function public.get_profile_reviews(uuid,integer,integer),public.get_public_seller_profile_v2(uuid) to authenticated;

create function public.ugc_report_content_v1(p_report uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_report public.reports%rowtype; v_content jsonb;
begin
  select * into v_report from public.reports where id=p_report;
  if not found then raise exception 'Report unavailable'; end if;
  if v_report.report_type='listing' then
    select jsonb_build_object('id',l.id,'seller_id',l.seller_id,'title',l.title,'description',l.description,
      'brand',l.brand,'category',l.category,'status',l.status,'created_at',l.created_at,
      'images',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'path',i.storage_path) order by i.sort_order,i.id)
        from public.listing_images i join storage.objects o on o.bucket_id='listing-images' and o.name=i.storage_path
        where i.listing_id=l.id and o.owner_id=l.seller_id::text
          and public.listing_image_path_matches_v1(i.storage_path,l.seller_id,l.id)),'[]'::jsonb))
    into v_content from public.listings l where l.id=v_report.target_id;
  elsif v_report.report_type='message' then
    select jsonb_build_object('id',m.id,'sender_id',m.sender_id,'body',m.body,'created_at',m.created_at,
      'conversation_id',c.id,'listing_id',c.listing_id,'listing_title',l.title)
    into v_content from public.messages m join public.conversations c on c.id=m.conversation_id
    left join public.listings l on l.id=c.listing_id
    where m.id=v_report.target_id and m.conversation_id=v_report.conversation_id;
  elsif v_report.report_type='review' then
    select jsonb_build_object('id',r.id,'reviewer_id',r.reviewer_id,'reviewee_id',r.reviewee_id,
      'body',r.body,'rating',r.rating,'created_at',r.created_at,'listing_id',v_report.listing_id)
    into v_content from public.marketplace_reviews r where r.id=v_report.target_id;
  elsif v_report.report_type='seller' then
    select jsonb_build_object('id',p.id,'display_name',p.display_name,'username',p.username,'bio',p.bio,
      'avatar_url',p.avatar_url,'city',p.city,'state',p.state,'created_at',p.created_at)
    into v_content from public.profiles p where p.id=v_report.target_id;
  end if;
  return v_content;
end $$;
revoke all on function public.ugc_report_content_v1(uuid) from public,anon,authenticated,service_role;

create function public.staff_inspect_report_v1(p_staff_id uuid,p_report_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_report public.reports%rowtype; v_live jsonb; v_evidence jsonb; v_active boolean;
begin
  perform public.phase_f_staff_role(p_staff_id,false);
  select * into v_report from public.reports where id=p_report_id;
  if not found then raise exception 'Report unavailable'; end if;
  v_live:=public.ugc_report_content_v1(p_report_id);
  select snapshot,active into v_evidence,v_active from public.ugc_moderation_evidence
    where target_type=v_report.report_type and target_id=v_report.target_id order by active desc,captured_at desc,id desc limit 1;
  insert into public.staff_action_log(staff_user_id,action_type,target_type,target_id,safe_metadata)
    values(p_staff_id,'ugc_inspect','report',p_report_id,jsonb_build_object('outcome','inspected'));
  return jsonb_build_object('report_id',v_report.id,'type',v_report.report_type,'status',v_report.status,
    'reason',v_report.reason,'details',v_report.details,'created_at',v_report.created_at,
    'resolution_note',v_report.resolution_note,'reviewed_by',v_report.reviewed_by,'reviewed_at',v_report.reviewed_at,
    'content',case when coalesce(v_active,false) then v_evidence else v_live end,
    'suppressed',coalesce(v_active,false),'revision',md5(coalesce(v_live,'null'::jsonb)::text),
    'history',coalesce((select jsonb_agg(jsonb_build_object('actor',a.staff_user_id,'action',a.action_type,
      'timestamp',a.created_at,'outcome',coalesce(a.safe_metadata->>'outcome',a.safe_metadata->>'status'),'note',a.safe_metadata->>'note') order by a.created_at)
      from public.staff_action_log a where a.target_type='report' and a.target_id=p_report_id),'[]'::jsonb));
end $$;
revoke all on function public.staff_inspect_report_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_inspect_report_v1(uuid,uuid) to service_role;

create function public.staff_suppress_report_content_v1(p_staff_id uuid,p_report_id uuid,p_action text,p_note text,p_revision text)
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
  -- Do not undo anonymization performed by the existing delete-account workflow.
  -- This is a restoration guard, not suspended-user enforcement.
  if p_action='restore' and exists(select 1 from public.profiles p
    where p.id=(case v_report.report_type when 'listing' then v_content->>'seller_id'
      when 'message' then v_content->>'sender_id' when 'review' then v_content->>'reviewer_id'
      else v_content->>'id' end)::uuid
      and p.display_name='Deleted member' and p.username='deleted_'||substr(replace(p.id::text,'-',''),1,12)) then
    raise exception 'Deleted account content cannot be restored';
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
-- Keep the legacy listing action from bypassing report evidence, revisions and restore checks.
create or replace function public.staff_moderate_listing_v1(p_staff_id uuid,p_listing_id uuid,p_action text,p_reason text default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_listing public.listings%rowtype; v_changed boolean:=false;
begin
  perform public.phase_f_staff_role(p_staff_id,false);
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'Listing unavailable'; end if;
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

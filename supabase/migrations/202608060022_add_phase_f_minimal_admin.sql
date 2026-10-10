-- Phase F: minimal private-beta staff authorization and moderation state.

create table public.staff_roles (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  role text not null check (role in ('admin','moderator')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict
);
alter table public.staff_roles enable row level security;
revoke all on table public.staff_roles from public, anon, authenticated;
grant select, insert, update on table public.staff_roles to service_role;

create table public.staff_action_log (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references public.profiles(id) on delete restrict,
  action_type text not null check (char_length(action_type) between 3 and 80),
  target_type text not null check (target_type in ('report','dispute','user','listing','financial_reconciliation')),
  target_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index staff_action_log_staff_created_idx on public.staff_action_log(staff_user_id,created_at desc);
create index staff_action_log_target_idx on public.staff_action_log(target_type,target_id,created_at desc);
alter table public.staff_action_log enable row level security;
revoke all on table public.staff_action_log from public, anon, authenticated;
grant select, insert on table public.staff_action_log to service_role;

alter table public.profiles
  add column account_suspended_at timestamptz,
  add column account_suspended_by uuid references public.profiles(id) on delete restrict,
  add column staff_sell_restricted boolean not null default false;

alter table public.listings
  add column moderation_hidden_at timestamptz,
  add column moderation_hidden_by uuid references public.profiles(id) on delete restrict,
  add column moderation_reason text,
  add column moderation_prior_status text;

create index profiles_staff_restricted_idx on public.profiles(staff_sell_restricted) where staff_sell_restricted or account_suspended_at is not null;
create index listings_moderation_hidden_idx on public.listings(moderation_hidden_at) where moderation_hidden_at is not null;

create function public.protect_staff_managed_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.role() <> 'service_role' and (
    old.account_suspended_at is distinct from new.account_suspended_at or
    old.account_suspended_by is distinct from new.account_suspended_by or
    old.staff_sell_restricted is distinct from new.staff_sell_restricted
  ) then raise exception using errcode='42501',message='Staff-managed fields cannot be changed.'; end if;
  return new;
end $$;
create trigger profiles_protect_staff_fields before update on public.profiles
for each row execute function public.protect_staff_managed_fields();

create function public.enforce_listing_moderation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then
    if new.moderation_hidden_at is not null or new.moderation_hidden_by is not null
      or new.moderation_reason is not null or new.moderation_prior_status is not null then
      if tg_op = 'INSERT' then raise exception using errcode='42501',message='Moderation fields cannot be changed.'; end if;
    end if;
    if tg_op = 'UPDATE' and (new.moderation_hidden_at is distinct from old.moderation_hidden_at
      or new.moderation_hidden_by is distinct from old.moderation_hidden_by
      or new.moderation_reason is distinct from old.moderation_reason
      or new.moderation_prior_status is distinct from old.moderation_prior_status) then
      raise exception using errcode='42501',message='Moderation fields cannot be changed.';
    end if;
    if tg_op = 'UPDATE' and old.moderation_hidden_at is not null and new.status is distinct from old.status then
      raise exception using errcode='42501',message='Hidden listing cannot be restored by seller.';
    end if;
    if new.status = 'active' and exists(select 1 from public.profiles p where p.id=new.seller_id and (p.staff_sell_restricted or p.account_suspended_at is not null)) then
      raise exception using errcode='42501',message='Selling is restricted.';
    end if;
  end if;
  return new;
end $$;
create trigger listings_enforce_moderation before insert or update on public.listings
for each row execute function public.enforce_listing_moderation();

create or replace function public.is_listing_checkout_eligible(p_listing_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists(
    select 1 from public.listings l
    join public.profiles p on p.id=l.seller_id
    join public.seller_payment_accounts spa on spa.user_id=l.seller_id
    where l.id=p_listing_id and l.status='active' and l.moderation_hidden_at is null
      and not p.staff_sell_restricted and p.account_suspended_at is null
      and spa.onboarding_status='enabled' and spa.details_submitted and spa.payouts_enabled
      and spa.transfer_capability_status='active' and spa.risk_tier <> 'restricted'
  )
$$;
revoke all on function public.is_listing_checkout_eligible(uuid) from public,anon,authenticated;
grant execute on function public.is_listing_checkout_eligible(uuid) to authenticated;

comment on table public.staff_roles is 'Service-role-managed staff authorization. No client can read or mutate roles.';
comment on table public.staff_action_log is 'Append-only service-written staff action history; no update/delete grants.';

create function public.phase_f_staff_role(p_staff_id uuid, p_admin_only boolean default false)
returns text language plpgsql security definer set search_path='' stable as $$
declare v_role text;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='Trusted backend required.'; end if;
  select role into v_role from public.staff_roles where user_id=p_staff_id and active;
  if v_role is null or (p_admin_only and v_role<>'admin') then raise exception using errcode='42501',message='Staff access denied.'; end if;
  return v_role;
end $$;

create function public.staff_moderate_report_v1(p_staff_id uuid,p_report_id uuid,p_action text,p_note text default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_status text; v_next text;
begin
  perform public.phase_f_staff_role(p_staff_id,false);
  if p_action not in ('under_review','resolved','dismissed') then raise exception 'Invalid action'; end if;
  if p_action in ('resolved','dismissed') and char_length(btrim(coalesce(p_note,''))) not between 3 and 500 then raise exception 'Resolution note required'; end if;
  select status into v_status from public.reports where id=p_report_id for update;
  if not found then raise exception 'Report unavailable'; end if;
  v_next:=p_action;
  if v_status=v_next then return v_status; end if;
  if v_status in ('resolved','dismissed') then raise exception 'Report already closed'; end if;
  update public.reports set status=v_next,reviewed_by=p_staff_id,reviewed_at=coalesce(reviewed_at,now()),resolution_note=case when v_next='under_review' then null else btrim(p_note) end where id=p_report_id;
  insert into public.staff_action_log(staff_user_id,action_type,target_type,target_id,safe_metadata)
  values(p_staff_id,'report_'||v_next,'report',p_report_id,jsonb_build_object('status',v_next));
  return v_next;
end $$;

create function public.staff_moderate_user_v1(p_staff_id uuid,p_user_id uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $$
declare v_role text; v_changed boolean:=false;
begin
  v_role:=public.phase_f_staff_role(p_staff_id,true);
  if p_user_id=p_staff_id then raise exception 'Staff cannot moderate their own account'; end if;
  if p_action='suspend' then update public.profiles set account_suspended_at=coalesce(account_suspended_at,now()),account_suspended_by=coalesce(account_suspended_by,p_staff_id) where id=p_user_id and account_suspended_at is null returning true into v_changed;
  elsif p_action='unsuspend' then update public.profiles set account_suspended_at=null,account_suspended_by=null where id=p_user_id and account_suspended_at is not null returning true into v_changed;
  elsif p_action='restrict_selling' then update public.profiles set staff_sell_restricted=true where id=p_user_id and not staff_sell_restricted returning true into v_changed;
  elsif p_action='unrestrict_selling' then update public.profiles set staff_sell_restricted=false where id=p_user_id and staff_sell_restricted returning true into v_changed;
  else raise exception 'Invalid action'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'User unavailable'; end if;
  if v_changed then insert into public.staff_action_log(staff_user_id,action_type,target_type,target_id) values(p_staff_id,p_action,'user',p_user_id); end if;
  return p_action;
end $$;

create function public.staff_moderate_listing_v1(p_staff_id uuid,p_listing_id uuid,p_action text,p_reason text default null)
returns text language plpgsql security definer set search_path='' as $$
declare v_listing public.listings%rowtype; v_changed boolean:=false;
begin
  perform public.phase_f_staff_role(p_staff_id,false);
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'Listing unavailable'; end if;
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

create function public.staff_resolve_dispute_v1(p_staff_id uuid,p_dispute_id uuid,p_resolution text,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_status text; v_order_id uuid;
begin
  perform public.phase_f_staff_role(p_staff_id,false);
  select status,order_id into v_status,v_order_id from public.order_disputes where id=p_dispute_id for update;
  if not found then raise exception 'Dispute unavailable'; end if;
  if v_status=p_resolution then return v_order_id; end if;
  perform public.resolve_order_dispute_v1(p_dispute_id,p_resolution,p_note);
  insert into public.staff_action_log(staff_user_id,action_type,target_type,target_id,safe_metadata)
  values(p_staff_id,'dispute_'||p_resolution,'dispute',p_dispute_id,jsonb_build_object('resolution',p_resolution,'orderId',v_order_id));
  return v_order_id;
end $$;

create function public.staff_log_reconciliation_retry_v1(p_staff_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.phase_f_staff_role(p_staff_id,true);
  insert into public.staff_action_log(staff_user_id,action_type,target_type,safe_metadata)
  values(p_staff_id,'reconciliation_retry','financial_reconciliation',jsonb_build_object('scope','bounded_worker'));
end $$;

revoke all on function public.phase_f_staff_role(uuid,boolean),public.staff_moderate_report_v1(uuid,uuid,text,text),public.staff_moderate_user_v1(uuid,uuid,text),public.staff_moderate_listing_v1(uuid,uuid,text,text),public.staff_resolve_dispute_v1(uuid,uuid,text,text),public.staff_log_reconciliation_retry_v1(uuid) from public,anon,authenticated;
grant execute on function public.phase_f_staff_role(uuid,boolean),public.staff_moderate_report_v1(uuid,uuid,text,text),public.staff_moderate_user_v1(uuid,uuid,text),public.staff_moderate_listing_v1(uuid,uuid,text,text),public.staff_resolve_dispute_v1(uuid,uuid,text,text),public.staff_log_reconciliation_retry_v1(uuid) to service_role;

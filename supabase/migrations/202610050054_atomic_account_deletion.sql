-- Keep retained marketplace records and Auth soft deletion in one transaction.
-- Storage removal stays in the Edge Function, before this transaction, and is retryable.
begin;

-- Only the Auth DB role, nested in its soft-delete transaction, can use this
-- transaction may use this cleanup context. API clients receive no EXECUTE permission.
create function public.in_account_deletion_finalizer_v1(p_user_id uuid)
returns boolean language sql volatile security definer set search_path = '' as $$
  select coalesce((session_user = 'supabase_auth_admin'
      or current_setting('role', true) = 'supabase_auth_admin')
    and pg_trigger_depth() > 1
    and exists (select 1 from public.account_deletion_state where user_id = p_user_id)
    and exists (select 1 from auth.users where id = p_user_id and deleted_at is not null
      -- The Auth row must have been written by this very transaction, not just
      -- be an older deleted account. Compare the 32-bit xid to xid8's low bits.
      and xmin::text::bigint = pg_current_xact_id()::text::bigint % 4294967296), false);
$$;
revoke all on function public.in_account_deletion_finalizer_v1(uuid) from public, anon, authenticated, service_role;

create or replace function public.prevent_notification_identity_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The sole additional mutation is clearing a deleting account's actor reference.
  -- No client grants or RLS policies change; all other identity fields stay immutable.
  if (auth.role() = 'service_role' or public.in_account_deletion_finalizer_v1(old.actor_id))
    and old.actor_id is not null and new.actor_id is null then
    if exists (select 1 from public.account_deletion_state where user_id = old.actor_id)
      and (to_jsonb(new) - 'actor_id' - 'is_read') = (to_jsonb(old) - 'actor_id' - 'is_read') then
      return new;
    end if;
  end if;
  if (to_jsonb(new) - 'is_read') is distinct from (to_jsonb(old) - 'is_read') then
    raise exception 'Only notification read state may be changed.';
  end if;
  return new;
end $$;

create or replace function public.guard_deleted_account_content_v1()
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
  if (auth.role() is distinct from 'service_role' and not public.in_account_deletion_finalizer_v1(v_owner)) or tg_op='INSERT' then
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

create or replace function public.guard_ugc_moderation_fields_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.role()='service_role' or public.in_account_deletion_finalizer_v1(
    (to_jsonb(new)->>(case tg_table_name when 'profiles' then 'id' when 'messages' then 'sender_id' else 'reviewer_id' end))::uuid
  ) then return new; end if;
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

create function public.finalize_account_deletion_v1()
returns trigger language plpgsql security definer
set search_path = ''
-- Do not alter JWT claims, GUC permissions, or connection role settings.
as $$
declare v_deleted_at timestamptz := new.deleted_at;
begin
  if not exists (select 1 from public.account_deletion_state where user_id = new.id) then
    return new;
  end if;
  perform 1 from public.profiles where id = new.id for update;
  if not found then raise exception 'Account unavailable'; end if;

  -- Recheck the existing eligibility rules inside the final transaction.
  if exists (select 1 from public.local_sale_confirmations
      where new.id in (buyer_id, seller_id) and status = 'pending_buyer_confirmation')
    or exists (select 1 from public.orders where new.id in (buyer_id, seller_id) and (
      fulfillment_status not in ('completed','canceled')
      or payment_status in ('pending','processing','refund_pending','disputed')
      or dispute_status in ('open','awaiting_buyer_evidence','awaiting_seller_response','under_review','external_chargeback')
      or refund_status in ('pending','reconciling'))) then
    raise exception 'Resolve active transactions before deleting your account.';
  end if;

  update public.profiles set
    display_name = 'Deleted member',
    username = 'deleted_' || substr(replace(new.id::text, '-', ''), 1, 12),
    bio = null, avatar_url = null, city = null, state = null, postal_code = null,
    account_suspended_at = v_deleted_at, account_suspended_by = null,
    staff_sell_restricted = true
  where id = new.id;

  update public.listings set
    status = case when status in ('draft','active','reserved','expired') then 'archived' else status end,
    title = 'Removed listing', description = 'Removed after account deletion.',
    brand = null, city = null, state = null, postal_code = null,
    latitude = null, longitude = null, location_source = null,
    location_updated_at = v_deleted_at
  where seller_id = new.id;
  delete from public.listing_images where listing_id in
    (select id from public.listings where seller_id = new.id);
  delete from public.chat_image_upload_reservations where sender_id = new.id;

  update public.push_tokens set
    expo_push_token = 'ExpoPushToken[deleted_' || replace(id::text, '-', '') || ']',
    disabled_at = v_deleted_at, device_id = null, app_version = null
  where user_id = new.id;
  update public.messages set body = 'Message removed after account deletion.', deleted_at = v_deleted_at
    where sender_id = new.id;
  update public.marketplace_reviews set body = null where reviewer_id = new.id;
  update public.notifications set actor_id = null where actor_id = new.id;
  update public.marketplace_analytics_events set user_id = null where user_id = new.id;
  update public.marketplace_operational_errors set user_id = null where user_id = new.id;
  update public.marketplace_beta_feedback set category = 'other', description = 'Removed after account deletion.'
    where user_id = new.id;
  update public.staff_roles set active = false where user_id = new.id;
  delete from public.favorites where user_id = new.id;
  delete from public.recently_viewed_listings where user_id = new.id;
  delete from public.notifications where user_id = new.id;
  delete from public.conversation_reads where user_id = new.id;
  delete from public.marketplace_notification_events where user_id = new.id;
  return new;
end $$;
revoke all on function public.finalize_account_deletion_v1() from public, anon, authenticated, service_role;

-- Supabase Auth soft deletion updates deleted_at inside its transaction, which
-- also removes credentials, identities and sessions. Any cleanup/Auth failure
-- rolls back this entire database transaction, including profile anonymization.
create trigger auth_user_finalize_account_deletion
after update of deleted_at on auth.users
for each row when (old.deleted_at is null and new.deleted_at is not null)
execute function public.finalize_account_deletion_v1();

commit;

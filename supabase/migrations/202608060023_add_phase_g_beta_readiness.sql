-- Phase G: privacy-limited analytics, operational errors, beta feedback, and staff metrics.

create table public.marketplace_analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  event_name text not null check (event_name in (
    'signup_completed','login_completed','listing_created','listing_viewed','listing_saved','listing_shared','listing_reported',
    'search_performed','filter_applied','conversation_started','message_sent','stripe_onboarding_started','stripe_onboarding_completed',
    'checkout_started','checkout_payment_sheet_opened','checkout_succeeded','checkout_failed','pickup_ready','pickup_confirmed',
    'shipment_recorded','delivery_confirmed','inspection_completed','review_submitted','dispute_opened'
  )),
  entity_type text check (entity_type is null or entity_type in ('listing','order','conversation','review','report','seller')),
  entity_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata)='object' and octet_length(safe_metadata::text)<=2048),
  created_at timestamptz not null default now()
);
create index marketplace_analytics_event_time_idx on public.marketplace_analytics_events(event_name,created_at desc);
create index marketplace_analytics_user_time_idx on public.marketplace_analytics_events(user_id,created_at desc) where user_id is not null;
alter table public.marketplace_analytics_events enable row level security;
revoke all on table public.marketplace_analytics_events from public,anon,authenticated;
grant select,insert on table public.marketplace_analytics_events to service_role;

create function public.record_signup_analytics_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.marketplace_analytics_events(user_id,event_name,safe_metadata) values(new.id,'signup_completed','{}');
  return new;
end $$;
create trigger profiles_record_signup_analytics after insert on public.profiles
for each row execute function public.record_signup_analytics_event();

create table public.marketplace_operational_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('app','edge','webhook','reconciliation','admin')),
  error_code text not null check (char_length(error_code) between 2 and 80),
  operation text check (operation is null or char_length(operation) between 2 and 80),
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata)='object' and octet_length(safe_metadata::text)<=1024),
  created_at timestamptz not null default now()
);
create index marketplace_operational_errors_time_idx on public.marketplace_operational_errors(source,created_at desc);
alter table public.marketplace_operational_errors enable row level security;
revoke all on table public.marketplace_operational_errors from public,anon,authenticated;
grant select,insert on table public.marketplace_operational_errors to service_role;

create table public.marketplace_reconciliation_runs (
  id uuid primary key,
  status text not null check (status in ('running','succeeded','failed')),
  safe_result jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_result)='object' and octet_length(safe_result::text)<=2048),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index marketplace_reconciliation_runs_time_idx on public.marketplace_reconciliation_runs(started_at desc);
alter table public.marketplace_reconciliation_runs enable row level security;
revoke all on table public.marketplace_reconciliation_runs from public,anon,authenticated;
grant select,insert,update on table public.marketplace_reconciliation_runs to service_role;

create table public.marketplace_beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  category text not null check (category in ('bug','feature_request','payment_problem','listing_problem','messaging_problem','other')),
  description text not null check (description=btrim(description) and char_length(description) between 10 and 2000),
  status text not null default 'new' check (status in ('new','reviewing','resolved')),
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='new' and reviewed_by is null and reviewed_at is null) or status in ('reviewing','resolved'))
);
create index marketplace_beta_feedback_status_idx on public.marketplace_beta_feedback(status,created_at desc);
alter table public.marketplace_beta_feedback enable row level security;
revoke all on table public.marketplace_beta_feedback from public,anon,authenticated;
grant select,insert,update on table public.marketplace_beta_feedback to service_role;

alter table public.staff_action_log drop constraint staff_action_log_target_type_check;
alter table public.staff_action_log add constraint staff_action_log_target_type_check
  check (target_type in ('report','dispute','user','listing','financial_reconciliation','beta_feedback'));

create function public.record_marketplace_analytics_event_v1(p_event_name text,p_entity_type text default null,p_entity_id uuid default null,p_metadata jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_safe jsonb;
begin
  if auth.role()<>'authenticated' or v_actor is null then raise exception using errcode='42501',message='Authentication required.'; end if;
  if p_event_name not in ('signup_completed','login_completed','listing_created','listing_viewed','listing_saved','listing_shared','listing_reported','search_performed','filter_applied','conversation_started','message_sent','stripe_onboarding_started','stripe_onboarding_completed','checkout_started','checkout_payment_sheet_opened','checkout_succeeded','checkout_failed','pickup_ready','pickup_confirmed','shipment_recorded','delivery_confirmed','inspection_completed','review_submitted','dispute_opened') then raise exception 'Unsupported analytics event'; end if;
  if p_entity_type is not null and p_entity_type not in ('listing','order','conversation','review','report','seller') then raise exception 'Unsupported entity type'; end if;
  if jsonb_typeof(coalesce(p_metadata,'{}'))<>'object' or octet_length(coalesce(p_metadata,'{}')::text)>2048 then raise exception 'Invalid analytics metadata'; end if;
  if (select count(*) from public.marketplace_analytics_events where user_id=v_actor and created_at>now()-interval '1 hour')>=120 then return; end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into v_safe from jsonb_each(coalesce(p_metadata,'{}'))
    where key in ('category','fulfillment_type','result_status','filter_count','price_bucket','screen','method');
  insert into public.marketplace_analytics_events(user_id,event_name,entity_type,entity_id,safe_metadata) values(v_actor,p_event_name,p_entity_type,p_entity_id,v_safe);
end $$;

create function public.record_marketplace_client_error_v1(p_error_code text,p_operation text default null,p_metadata jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_safe jsonb;
begin
  if auth.role()<>'authenticated' or v_actor is null then return; end if;
  if char_length(coalesce(p_error_code,'')) not between 2 and 80 or p_error_code!~'^[A-Z0-9_:-]+$' then return; end if;
  if p_operation is not null and (char_length(p_operation) not between 2 and 80 or p_operation!~'^[a-z0-9_:-]+$') then return; end if;
  if (select count(*) from public.marketplace_operational_errors where user_id=v_actor and created_at>now()-interval '1 hour')>=30 then return; end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into v_safe from jsonb_each(coalesce(p_metadata,'{}')) where key in ('screen','result_status');
  insert into public.marketplace_operational_errors(user_id,source,error_code,operation,safe_metadata) values(v_actor,'app',p_error_code,p_operation,v_safe);
end $$;

create function public.submit_marketplace_beta_feedback_v1(p_category text,p_description text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_id uuid;
begin
  if auth.role()<>'authenticated' or v_actor is null then raise exception using errcode='42501',message='Authentication required.'; end if;
  if p_category not in ('bug','feature_request','payment_problem','listing_problem','messaging_problem','other') or char_length(btrim(coalesce(p_description,''))) not between 10 and 2000 then raise exception 'Invalid feedback'; end if;
  if (select count(*) from public.marketplace_beta_feedback where user_id=v_actor and created_at>now()-interval '1 hour')>=5 then raise exception 'Feedback rate limit reached'; end if;
  insert into public.marketplace_beta_feedback(user_id,category,description) values(v_actor,p_category,btrim(p_description)) returning id into v_id;
  return v_id;
end $$;

create function public.staff_update_beta_feedback_v1(p_staff_id uuid,p_feedback_id uuid,p_status text)
returns text language plpgsql security definer set search_path='' as $$
declare v_current text;
begin
  perform public.phase_f_staff_role(p_staff_id,false);
  if p_status not in ('reviewing','resolved') then raise exception 'Invalid feedback status'; end if;
  select status into v_current from public.marketplace_beta_feedback where id=p_feedback_id for update;
  if not found then raise exception 'Feedback unavailable'; end if;
  if v_current=p_status then return v_current; end if;
  if v_current='resolved' then raise exception 'Feedback already resolved'; end if;
  update public.marketplace_beta_feedback set status=p_status,reviewed_by=p_staff_id,reviewed_at=coalesce(reviewed_at,now()),updated_at=now() where id=p_feedback_id;
  insert into public.staff_action_log(staff_user_id,action_type,target_type,target_id,safe_metadata) values(p_staff_id,'feedback_'||p_status,'beta_feedback',p_feedback_id,jsonb_build_object('status',p_status));
  return p_status;
end $$;

create function public.get_private_beta_metrics_v1()
returns jsonb language sql security definer set search_path='' stable as $$
select case when auth.role()<>'service_role' then null else jsonb_build_object(
  'totalUsers',(select count(*) from public.profiles),
  'activeUsers7d',(select count(distinct user_id) from public.marketplace_analytics_events where created_at>=now()-interval '7 days'),
  'newUsersToday',(select count(*) from public.profiles where created_at>=date_trunc('day',now())),
  'newUsers7d',(select count(*) from public.profiles where created_at>=now()-interval '7 days'),
  'activeListings',(select count(*) from public.listings where status='active' and moderation_hidden_at is null),
  'listingsCreated7d',(select count(*) from public.listings where created_at>=now()-interval '7 days'),
  'completedSales',(select count(*) from public.orders where fulfillment_status='completed' and payment_status='succeeded'),
  'gmvCents',(select coalesce(sum(total_amount),0) from public.orders where payment_status='succeeded'),
  'marketplaceFeeRevenueCents',(select coalesce(sum(marketplace_fee_amount),0) from public.orders where payment_status='succeeded'),
  'averageItemSalePriceCents',(select coalesce(round(avg(item_amount)),0) from public.orders where payment_status='succeeded'),
  'checkoutStarted',(select count(*) from public.marketplace_analytics_events where event_name='checkout_started'),
  'checkoutSucceeded',(select count(*) from public.payments where status='succeeded'),
  'checkoutSuccessRate',(select coalesce(round(100.0*(select count(*) from public.payments where status='succeeded' and created_at>=coalesce((select min(created_at) from public.marketplace_analytics_events where event_name='checkout_started'),now()))/nullif(count(*),0),1),0) from public.marketplace_analytics_events where event_name='checkout_started'),
  'sellerOnboardingRate',(select coalesce(round(100.0*count(*) filter(where onboarding_status='enabled')/nullif(count(*),0),1),0) from public.seller_payment_accounts),
  'pickupCompleted',(select count(*) from public.orders where fulfillment_type='pickup' and fulfillment_status='completed'),
  'shippingCompleted',(select count(*) from public.orders where fulfillment_type='shipping' and fulfillment_status='completed'),
  'openDisputes',(select count(*) from public.order_disputes where status in ('open','awaiting_seller_response','under_review')),
  'openReports',(select count(*) from public.reports where status in ('pending','under_review')),
  'funnelViews',(select count(*) from public.marketplace_analytics_events where event_name='listing_viewed'),
  'funnelCheckoutStarts',(select count(*) from public.marketplace_analytics_events where event_name='checkout_started'),
  'funnelPayments',(select count(*) from public.payments where status='succeeded'),
  'funnelFulfilled',(select count(*) from public.orders where fulfillment_status='completed' and payment_status='succeeded'),
  'sellerAccounts',(select count(*) from public.profiles),
  'sellerListingCreators',(select count(distinct seller_id) from public.listings),
  'sellerOnboarded',(select count(*) from public.seller_payment_accounts where onboarding_status='enabled'),
  'sellerFirstSales',(select count(distinct seller_id) from public.orders where payment_status='succeeded')
) end
$$;

revoke all on function public.record_marketplace_analytics_event_v1(text,text,uuid,jsonb),public.record_marketplace_client_error_v1(text,text,jsonb),public.submit_marketplace_beta_feedback_v1(text,text),public.staff_update_beta_feedback_v1(uuid,uuid,text),public.get_private_beta_metrics_v1() from public,anon,authenticated;
revoke all on function public.record_signup_analytics_event() from public,anon,authenticated;
grant execute on function public.record_marketplace_analytics_event_v1(text,text,uuid,jsonb),public.record_marketplace_client_error_v1(text,text,jsonb),public.submit_marketplace_beta_feedback_v1(text,text) to authenticated;
grant execute on function public.staff_update_beta_feedback_v1(uuid,uuid,text),public.get_private_beta_metrics_v1() to service_role;

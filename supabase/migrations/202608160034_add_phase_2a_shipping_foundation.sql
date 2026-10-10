-- Phase 2A: immutable domestic shipping destinations, workflow versioning,
-- exact flat-shipping validation, and server-owned three-business-day deadlines.
-- This migration does not verify carriers, enforce deadlines, or move money.

create table public.marketplace_server_config (
  key text primary key,
  integer_value bigint not null check (integer_value >= 0),
  updated_at timestamptz not null default now()
);

insert into public.marketplace_server_config(key, integer_value)
values ('shipping_charge_max_cents', 50000);

alter table public.marketplace_server_config enable row level security;
revoke all on table public.marketplace_server_config from public, anon, authenticated;
grant select, insert, update on table public.marketplace_server_config to service_role;

-- Removing the numeric scale prevents PostgreSQL from silently rounding a
-- client value before the validation trigger can reject excess precision.
alter table public.listings
  alter column shipping_price type numeric using shipping_price::numeric;

create function public.enforce_flat_shipping_price_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max bigint;
begin
  if new.shipping_available then
    if new.shipping_price is null or new.shipping_price < 0
      or new.shipping_price * 100 <> trunc(new.shipping_price * 100) then
      raise exception using errcode='22023',message='Shipping price must be an exact non-negative cent amount.';
    end if;
    select integer_value into v_max from public.marketplace_server_config
      where key='shipping_charge_max_cents';
    if v_max is null or new.shipping_price * 100 > v_max then
      raise exception using errcode='22023',message='Shipping price exceeds the configured limit.';
    end if;
  elsif new.shipping_price is not null then
    raise exception using errcode='22023',message='Shipping price requires shipping availability.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_flat_shipping_price_v1() from public,anon,authenticated;
create trigger listings_enforce_flat_shipping_price_v1
before insert or update of shipping_available,shipping_price on public.listings
for each row execute function public.enforce_flat_shipping_price_v1();

alter table public.orders
  add column shipping_workflow_version smallint not null default 1
    check (shipping_workflow_version in (1,2)),
  add column ship_by_at timestamptz,
  add column ship_by_timezone text,
  add column ship_by_timezone_source text
    check (ship_by_timezone_source is null or ship_by_timezone_source in ('listing_location','platform_fallback')),
  add column ship_by_calculation_version smallint
    check (ship_by_calculation_version is null or ship_by_calculation_version = 1),
  add constraint orders_ship_by_metadata_check check (
    (ship_by_at is null and ship_by_timezone is null and ship_by_timezone_source is null and ship_by_calculation_version is null)
    or
    (ship_by_at is not null and ship_by_timezone is not null and ship_by_timezone_source is not null and ship_by_calculation_version = 1)
  );

comment on column public.orders.shipping_workflow_version is
  '1 = legacy/manual shipping truth; 2 = immutable destination and server deadline foundation. Version 2 does not imply carrier verification.';
comment on column public.orders.ship_by_at is
  'Exclusive UTC deadline boundary. Phase 2A records truth only and does not automatically cancel or refund.';

create table public.order_shipping_destinations (
  order_id uuid primary key references public.orders(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  recipient_name text not null check (char_length(recipient_name) between 2 and 120),
  address_line1 text not null check (char_length(address_line1) between 3 and 120),
  address_line2 text check (address_line2 is null or char_length(address_line2) between 1 and 120),
  city text not null check (char_length(city) between 2 and 80),
  region text not null check (region ~ '^[A-Z]{2}$'),
  postal_code text not null check (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  country_code text not null default 'US' check (country_code = 'US'),
  postal_match_value text not null check (postal_match_value ~ '^[0-9]{5}$'),
  validation_source text not null default 'shedmo_structural'
    check (validation_source = 'shedmo_structural'),
  validation_version smallint not null default 1 check (validation_version = 1),
  created_at timestamptz not null default now()
);

comment on table public.order_shipping_destinations is
  'Immutable structurally accepted domestic destination. It is not carrier-verified and must not be copied to logs, analytics, messages, or notification payloads.';

alter table public.order_shipping_destinations enable row level security;
create policy "Buyer reads own protected destination"
on public.order_shipping_destinations for select to authenticated
using (buyer_id = auth.uid());
create policy "Paid order seller reads operational destination"
on public.order_shipping_destinations for select to authenticated
using (exists (
  select 1 from public.orders o where o.id=order_shipping_destinations.order_id
    and o.seller_id=auth.uid() and o.payment_status='succeeded'
));
revoke all on table public.order_shipping_destinations from public,anon,authenticated;
grant select on table public.order_shipping_destinations to authenticated;
grant select,insert on table public.order_shipping_destinations to service_role;

create function public.prevent_shipping_destination_mutation_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='55000',message='Protected shipping destination is immutable.';
end;
$$;
revoke all on function public.prevent_shipping_destination_mutation_v1() from public,anon,authenticated;
create trigger order_shipping_destinations_immutable_v1
before update or delete on public.order_shipping_destinations
for each row execute function public.prevent_shipping_destination_mutation_v1();

create function public.calculate_shipping_deadline_v1(
  p_paid_at timestamptz,
  p_timezone text
)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare v_day date; v_count integer := 0;
begin
  if p_paid_at is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception using errcode='22023',message='Invalid deadline inputs.';
  end if;
  v_day := (p_paid_at at time zone p_timezone)::date;
  while v_count < 3 loop
    v_day := v_day + 1;
    if extract(isodow from v_day) between 1 and 5 then v_count := v_count + 1; end if;
  end loop;
  return ((v_day + 1)::timestamp at time zone p_timezone);
end;
$$;
revoke all on function public.calculate_shipping_deadline_v1(timestamptz,text) from public,anon,authenticated;
grant execute on function public.calculate_shipping_deadline_v1(timestamptz,text) to service_role;

create function public.reserve_listing_for_checkout_v2(
  p_listing_id uuid,
  p_fulfillment_type text,
  p_client_checkout_key uuid,
  p_recipient_name text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_region text default null,
  p_postal_code text default null,
  p_country_code text default null
)
returns table(order_id uuid,item_amount bigint,shipping_amount bigint,
  marketplace_fee_amount bigint,total_before_tax bigint,reservation_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_buyer uuid := auth.uid(); v_reserved record; v_order public.orders%rowtype;
  v_existing public.order_shipping_destinations%rowtype; v_listing public.listings%rowtype;
  v_recipient text; v_line1 text; v_line2 text; v_city text; v_region text;
  v_postal text; v_country text; v_max bigint;
begin
  if auth.role()<>'authenticated' or v_buyer is null then
    raise exception using errcode='42501',message='Authentication required.';
  end if;
  if p_fulfillment_type='shipping' then
    v_recipient:=btrim(coalesce(p_recipient_name,'')); v_line1:=btrim(coalesce(p_address_line1,''));
    v_line2:=nullif(btrim(coalesce(p_address_line2,'')),''); v_city:=initcap(btrim(coalesce(p_city,'')));
    v_region:=upper(btrim(coalesce(p_region,''))); v_postal:=upper(btrim(coalesce(p_postal_code,'')));
    v_country:=upper(btrim(coalesce(p_country_code,'')));
    if char_length(v_recipient) not between 2 and 120 or char_length(v_line1) not between 3 and 120
      or (v_line2 is not null and char_length(v_line2)>120) or char_length(v_city) not between 2 and 80
      or v_region !~ '^[A-Z]{2}$' or v_postal !~ '^[0-9]{5}(-[0-9]{4})?$' or v_country<>'US' then
      raise exception using errcode='22023',message='Invalid domestic shipping destination.';
    end if;
  elsif p_fulfillment_type='pickup' then
    if p_recipient_name is not null or p_address_line1 is not null or p_address_line2 is not null
      or p_city is not null or p_region is not null or p_postal_code is not null or p_country_code is not null then
      raise exception using errcode='22023',message='Pickup checkout does not accept a shipping destination.';
    end if;
  else raise exception using errcode='22023',message='Unsupported fulfillment type.';
  end if;

  select * into v_reserved from public.reserve_listing_for_checkout(
    p_listing_id,p_fulfillment_type,p_client_checkout_key
  );
  select * into v_order from public.orders where id=v_reserved.order_id for update;
  if not found or v_order.buyer_id<>v_buyer or v_order.listing_id<>p_listing_id
    or v_order.fulfillment_type<>p_fulfillment_type then
    raise exception using errcode='42501',message='Order binding failed.';
  end if;

  if p_fulfillment_type='shipping' then
    select * into v_listing from public.listings where id=p_listing_id;
    select integer_value into v_max from public.marketplace_server_config where key='shipping_charge_max_cents';
    if v_listing.shipping_price is null or v_listing.shipping_price<0
      or v_listing.shipping_price*100<>trunc(v_listing.shipping_price*100)
      or v_listing.shipping_price*100>v_max or v_order.shipping_amount<>v_listing.shipping_price*100 then
      raise exception using errcode='22023',message='Invalid protected shipping amount.';
    end if;
    insert into public.order_shipping_destinations(order_id,buyer_id,recipient_name,address_line1,address_line2,
      city,region,postal_code,country_code,postal_match_value)
    values(v_order.id,v_buyer,v_recipient,v_line1,v_line2,v_city,v_region,v_postal,v_country,left(v_postal,5))
    on conflict(order_id) do nothing;
    select * into v_existing from public.order_shipping_destinations where order_id=v_order.id;
    if not found or v_existing.buyer_id<>v_buyer or v_existing.recipient_name<>v_recipient
      or v_existing.address_line1<>v_line1 or v_existing.address_line2 is distinct from v_line2
      or v_existing.city<>v_city or v_existing.region<>v_region or v_existing.postal_code<>v_postal
      or v_existing.country_code<>v_country then
      raise exception using errcode='22023',message='Checkout destination mismatch.';
    end if;
    update public.orders set shipping_workflow_version=2 where id=v_order.id and shipping_workflow_version=1;
  end if;
  return query select v_reserved.order_id,v_reserved.item_amount,v_reserved.shipping_amount,
    v_reserved.marketplace_fee_amount,v_reserved.total_before_tax,v_reserved.reservation_expires_at;
end;
$$;

revoke all on function public.reserve_listing_for_checkout(uuid,text,uuid) from authenticated;
revoke all on function public.reserve_listing_for_checkout_v2(uuid,text,uuid,text,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.reserve_listing_for_checkout_v2(uuid,text,uuid,text,text,text,text,text,text,text)
  to authenticated;

create or replace function public.apply_checkout_payment_event(
  p_order_id uuid,p_payment_intent_id text,p_status text,p_amount bigint,p_currency text,
  p_charge_id text default null,p_failure_code text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_payment public.payments%rowtype;
  v_paid_at timestamptz; v_timezone text; v_timezone_source text;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='Trusted backend required.'; end if;
  if p_status not in ('processing','succeeded','failed','canceled') then raise exception using errcode='22023',message='Unsupported payment status.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='Order not found.'; end if;
  select * into v_payment from public.payments where order_id=p_order_id for update;
  if not found or v_payment.stripe_payment_intent_id is distinct from p_payment_intent_id
    or v_payment.amount is distinct from p_amount or v_payment.currency is distinct from lower(p_currency)
    or v_order.total_amount is distinct from p_amount or v_order.currency is distinct from lower(p_currency) then
    raise exception using errcode='22023',message='Payment data mismatch.';
  end if;
  if v_payment.status='succeeded' and p_status<>'succeeded' then return; end if;
  update public.payments set status=p_status,
    stripe_charge_id=case when p_status='succeeded' then coalesce(p_charge_id,stripe_charge_id) else stripe_charge_id end,
    failure_code=case when p_status='failed' then left(p_failure_code,100)
      when p_status in ('processing','succeeded') then null else failure_code end
    where order_id=p_order_id;
  if p_status='succeeded' then
    if v_order.fulfillment_type='shipping' and v_order.shipping_workflow_version=2
      and not exists(select 1 from public.order_shipping_destinations where order_id=p_order_id and buyer_id=v_order.buyer_id) then
      raise exception using errcode='55000',message='Protected shipping destination is missing.';
    end if;
    update public.listings set status='sold' where id=v_order.listing_id and status in ('reserved','sold');
    if not found then raise exception using errcode='55000',message='Listing state mismatch.'; end if;
    v_paid_at:=coalesce(v_order.paid_at,now());
    -- Phase 2A intentionally uses the documented deterministic fallback. A
    -- later resolver may choose a reliable listing IANA zone without client input.
    v_timezone:='America/Chicago'; v_timezone_source:='platform_fallback';
    update public.orders set payment_status='succeeded',paid_at=v_paid_at,
      fulfillment_status=case when fulfillment_type='pickup' then 'pickup_scheduled' else 'awaiting_shipment' end,
      ship_by_at=case when fulfillment_type='shipping' and shipping_workflow_version=2
        then coalesce(ship_by_at,public.calculate_shipping_deadline_v1(v_paid_at,v_timezone)) else ship_by_at end,
      ship_by_timezone=case when fulfillment_type='shipping' and shipping_workflow_version=2
        then coalesce(ship_by_timezone,v_timezone) else ship_by_timezone end,
      ship_by_timezone_source=case when fulfillment_type='shipping' and shipping_workflow_version=2
        then coalesce(ship_by_timezone_source,v_timezone_source) else ship_by_timezone_source end,
      ship_by_calculation_version=case when fulfillment_type='shipping' and shipping_workflow_version=2
        then coalesce(ship_by_calculation_version,1) else ship_by_calculation_version end
      where id=p_order_id;
  elsif p_status='processing' then
    update public.orders set payment_status='processing',fulfillment_status='awaiting_payment'
      where id=p_order_id and payment_status<>'succeeded';
  else update public.orders set payment_status=p_status where id=p_order_id and payment_status<>'succeeded';
  end if;
end;
$$;

revoke all on function public.apply_checkout_payment_event(uuid,text,text,bigint,text,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_checkout_payment_event(uuid,text,text,bigint,text,text,text)
  to service_role;

create index orders_shipping_deadline_idx on public.orders(ship_by_at)
where fulfillment_type='shipping' and shipping_workflow_version=2 and fulfillment_status='awaiting_shipment';

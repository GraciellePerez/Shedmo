-- Avoid PL/pgSQL output-column ambiguity in the retry-safe destination insert.

create or replace function public.reserve_listing_for_checkout_v2(
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
    on conflict on constraint order_shipping_destinations_pkey do nothing;
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

revoke all on function public.reserve_listing_for_checkout_v2(uuid,text,uuid,text,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.reserve_listing_for_checkout_v2(uuid,text,uuid,text,text,text,text,text,text,text)
  to authenticated;

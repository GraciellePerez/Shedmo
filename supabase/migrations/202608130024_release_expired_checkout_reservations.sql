-- Reclaim an expired checkout reservation when a buyer next attempts checkout.
-- Only orders that never reached Stripe payment processing are eligible.

create or replace function public.reserve_listing_for_checkout(
  p_listing_id uuid,
  p_fulfillment_type text,
  p_client_checkout_key uuid
)
returns table (
  order_id uuid,
  item_amount bigint,
  shipping_amount bigint,
  marketplace_fee_amount bigint,
  total_before_tax bigint,
  reservation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_seller_account public.seller_payment_accounts%rowtype;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_item_amount bigint;
  v_shipping_amount bigint;
  v_marketplace_fee bigint;
  v_listing_image text;
begin
  if auth.role() <> 'authenticated' or v_buyer_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_listing_id is null or p_client_checkout_key is null then
    raise exception using errcode = '22004', message = 'Listing and checkout key are required.';
  end if;
  if p_fulfillment_type not in ('pickup', 'shipping') then
    raise exception using errcode = '22023', message = 'Unsupported fulfillment type.';
  end if;

  select * into v_existing from public.orders o
  where o.client_checkout_key = p_client_checkout_key;
  if found then
    if v_existing.buyer_id <> v_buyer_id or v_existing.listing_id <> p_listing_id
      or v_existing.fulfillment_type <> p_fulfillment_type then
      raise exception using errcode = '22023', message = 'Checkout key parameter mismatch.';
    end if;
    if v_existing.reservation_expires_at <= now()
      and v_existing.payment_status in ('none','failed','canceled') then
      raise exception using errcode = '55000', message = 'Checkout expired. Start a new checkout.';
    end if;
    return query select v_existing.id, v_existing.item_amount,
      v_existing.shipping_amount, v_existing.marketplace_fee_amount,
      v_existing.item_amount + v_existing.shipping_amount,
      v_existing.reservation_expires_at;
    return;
  end if;

  select * into v_listing from public.listings l
  where l.id = p_listing_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Listing not found.';
  end if;

  -- A crashed or failed initialization must not strand inventory forever.
  -- The listing lock serializes this reclaim with checkout and payment events.
  if v_listing.status = 'reserved' then
    update public.orders o set
      payment_status = 'canceled',
      fulfillment_status = 'canceled',
      cancellation_reason = 'reservation_expired',
      canceled_at = coalesce(o.canceled_at, now())
    where o.listing_id = v_listing.id
      and o.fulfillment_status in ('reserved','awaiting_payment')
      and o.payment_status in ('none','failed','canceled')
      and o.reservation_expires_at <= now();
    if found then
      update public.listings set status = 'active' where id = v_listing.id;
      v_listing.status := 'active';
    end if;
  end if;

  if v_listing.status <> 'active' then
    raise exception using errcode = '55000', message = 'Listing is not available.';
  end if;
  if v_listing.seller_id = v_buyer_id then
    raise exception using errcode = '42501', message = 'Sellers cannot purchase their own listing.';
  end if;
  if p_fulfillment_type = 'pickup' and not v_listing.pickup_available then
    raise exception using errcode = '22023', message = 'Local pickup is not available.';
  end if;
  if p_fulfillment_type = 'shipping' and not v_listing.shipping_available then
    raise exception using errcode = '22023', message = 'Shipping is not available.';
  end if;

  select * into v_seller_account from public.seller_payment_accounts spa
  where spa.user_id = v_listing.seller_id;
  if not found or v_seller_account.stripe_account_id is null
    or v_seller_account.onboarding_status <> 'enabled'
    or not v_seller_account.details_submitted or not v_seller_account.payouts_enabled
    or v_seller_account.transfer_capability_status <> 'active' then
    raise exception using errcode = '55000', message = 'Seller payment onboarding is incomplete.';
  end if;

  v_item_amount := round(v_listing.price * 100)::bigint;
  if v_item_amount <= 0 then
    raise exception using errcode = '22023', message = 'Paid checkout requires a positive item price.';
  end if;
  if v_item_amount > 500000 then
    raise exception using errcode = '22023', message = 'Item exceeds the transaction limit.';
  end if;
  if v_seller_account.risk_tier = 'restricted' then
    raise exception using errcode = '55000', message = 'Seller account requires review.';
  end if;
  if v_seller_account.risk_tier = 'new' and v_item_amount > 100000 then
    raise exception using errcode = '55000', message = 'Transaction requires manual review.';
  end if;

  v_shipping_amount := case when p_fulfillment_type = 'shipping'
    then round(coalesce(v_listing.shipping_price, 0) * 100)::bigint else 0 end;
  v_marketplace_fee := public.calculate_marketplace_fee_cents(v_item_amount);
  select li.storage_path into v_listing_image from public.listing_images li
  where li.listing_id = v_listing.id order by li.sort_order, li.id limit 1;

  update public.listings set status = 'reserved' where id = v_listing.id;
  insert into public.orders (
    buyer_id,seller_id,listing_id,client_checkout_key,fulfillment_type,
    payment_status,fulfillment_status,dispute_status,transfer_status,
    item_amount,shipping_amount,tax_amount,marketplace_fee_amount,total_amount,
    currency,listing_title_snapshot,listing_condition_snapshot,
    listing_category_snapshot,listing_image_snapshot,reservation_expires_at
  ) values (
    v_buyer_id,v_listing.seller_id,v_listing.id,p_client_checkout_key,p_fulfillment_type,
    'none','reserved','none','not_eligible',v_item_amount,v_shipping_amount,0,
    v_marketplace_fee,v_item_amount + v_shipping_amount,'usd',v_listing.title,
    v_listing.condition,v_listing.category,v_listing_image,now() + interval '10 minutes'
  ) returning * into v_order;
  return query select v_order.id,v_order.item_amount,v_order.shipping_amount,
    v_order.marketplace_fee_amount,v_order.item_amount + v_order.shipping_amount,
    v_order.reservation_expires_at;
end;
$$;

revoke all on function public.reserve_listing_for_checkout(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_listing_for_checkout(uuid,text,uuid)
  to authenticated;

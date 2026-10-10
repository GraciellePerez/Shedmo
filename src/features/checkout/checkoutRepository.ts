import { requireSupabase } from '@/lib/supabase/client';
import type { CheckoutInitialization, FulfillmentType, MarketplaceOrderRow, PickupProof, ShippingDestinationInput } from './types';
import { telemetry } from '@/services/telemetry';

const ORDER_COLUMNS = 'id,buyer_id,seller_id,listing_id,fulfillment_type,payment_status,fulfillment_status,transfer_status,dispute_status,refund_status,cancellation_reason,item_amount,shipping_amount,tax_amount,total_amount,marketplace_fee_amount,actual_processing_amount,reserve_withheld_amount,seller_transfer_amount,currency,listing_title_snapshot,listing_image_snapshot,reservation_expires_at,paid_at,shipped_at,delivered_at,pickup_confirmed_at,inspection_expires_at,payout_eligible_at,payout_not_before,ship_by_at,ship_by_timezone,ship_by_timezone_source,shipping_workflow_version,completed_at,created_at,order_shipments(carrier,tracking_number,shipped_at,delivered_at,shipment_state,status_source,tracking_submitted_at,carrier_accepted_at),order_shipping_destinations(recipient_name,address_line1,address_line2,city,region,postal_code,country_code,validation_source),seller_payout_releases(amount,currency,status,transferred_at,processing_fee_amount,refund_deduction_amount,financial_adjustment_amount),order_disputes(id,dispute_type,status,buyer_explanation,seller_response,opened_at,resolved_at),order_refunds(amount,currency,reason,status,succeeded_at)';
const PAGE_SIZE = 20;

export async function initializeCheckout(
  listingId: string,
  fulfillmentType: FulfillmentType,
  clientCheckoutKey: string,
  destination?: ShippingDestinationInput,
) {
  const { data, error } = await requireSupabase().functions.invoke('create-checkout-payment', {
    body: { listingId, fulfillmentType, clientCheckoutKey, ...(destination ? { destination } : {}) },
  });
  if (error) {
    const status = getFunctionResponseStatus(error);
    const code = await getFunctionResponseCode(error);
    const checkoutError = new Error('CHECKOUT_START_FAILED');
    checkoutError.name = code
      ? `Checkout${toErrorName(code)}Error`
      : status ? `CheckoutHttp${status}Error` : 'CheckoutFunctionError';
    throw checkoutError;
  }
  if (!isCheckoutInitialization(data)) {
    const checkoutError = new Error('CHECKOUT_START_FAILED');
    checkoutError.name = 'CheckoutResponseError';
    throw checkoutError;
  }
  telemetry.track('checkout_started', 'order', data.orderId, { fulfillment_type: fulfillmentType });
  return data;
}

async function getFunctionResponseCode(error: unknown): Promise<string | null> {
  if (!error || typeof error !== 'object' || !('context' in error)) return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('clone' in context)) return null;
  const clone = (context as { clone?: unknown }).clone;
  if (typeof clone !== 'function') return null;
  const response = clone.call(context) as { json?: unknown };
  if (!response || typeof response.json !== 'function') return null;
  const body = await response.json().catch(() => null) as { code?: unknown } | null;
  return typeof body?.code === 'string' && /^[A-Z0-9_]{1,50}$/.test(body.code) ? body.code : null;
}

const toErrorName = (code: string) => code.toLowerCase().split('_')
  .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
  .join('');

function getFunctionResponseStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('context' in error)) return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('status' in context)) return null;
  const status = (context as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : null;
}

async function invokeOrderAction(name: string, body: Record<string, unknown>) {
  const { data, error } = await requireSupabase().functions.invoke(name, { body });
  if (error) {
    const responseCode = typeof data?.code === 'string' && /^[A-Z0-9_]{1,20}$/.test(data.code)
      ? data.code : await getFunctionResponseCode(error);
    const trackingMessage: Record<string, string> = {
      TRACKING_INVALID: 'Enter a tracking number that matches the selected carrier.',
      TRACKING_ALREADY_USED: 'This tracking number is already in use on an active shipment.',
      TRACKING_ORDER_INELIGIBLE: 'Tracking cannot be submitted for this order right now.',
      TRACKING_CHANGE_BLOCKED: 'Tracking cannot be changed after carrier acceptance.',
    };
    const actionError = new Error(typeof data?.error === 'string' ? data.error : responseCode ? trackingMessage[responseCode] ?? 'Order could not be updated.' : 'Order could not be updated.');
    if (responseCode) {
      actionError.name = `OrderAction${toErrorName(responseCode)}Error`;
    }
    if (__DEV__) console.info('[order:action:error]', { action: name, errorName: actionError.name });
    throw actionError;
  }
  const orderId=typeof body.orderId==='string'?body.orderId:typeof body.expectedOrderId==='string'?body.expectedOrderId:undefined;
  const events:Record<string,'pickup_ready'|'pickup_confirmed'|'shipment_recorded'|'delivery_confirmed'|'inspection_completed'|'dispute_opened'>={
    'mark-order-ready':'pickup_ready','complete-pickup':'pickup_confirmed','complete-pickup-by-pin':'pickup_confirmed','mark-shipped':'shipment_recorded','mark-delivered':'delivery_confirmed','accept-delivery':'inspection_completed','open-order-dispute':'dispute_opened',
  };
  if(events[name]&&orderId)telemetry.track(events[name],'order',orderId);
  return data as { orderId: string; status?: string };
}

export const markOrderReady = (orderId: string) => invokeOrderAction('mark-order-ready', { orderId });
export const completePickup = (expectedOrderId: string, proof: PickupProof) => invokeOrderAction('complete-pickup', {
  expectedOrderId, scannedOrderId: proof.orderId, buyerId: proof.buyerId, token: proof.token,
});
export const completePickupByPin = (orderId: string, pin: string) =>
  invokeOrderAction('complete-pickup-by-pin', { orderId, pin });
export const markDelivered = (orderId: string) => invokeOrderAction('mark-delivered', { orderId });
export const acceptDelivery = (orderId: string) => invokeOrderAction('accept-delivery', { orderId });
export const cancelOrder = (orderId: string) => invokeOrderAction('cancel-order', { orderId });
export const openOrderDispute = (
  orderId: string, type: 'item_not_received' | 'materially_not_as_described',
  explanation: string, evidencePaths: string[],
) => invokeOrderAction('open-order-dispute', { orderId, type, explanation, evidencePaths });
export const respondOrderDispute = (disputeId: string, response: string) =>
  invokeOrderAction('respond-order-dispute', { disputeId, response });
export const releaseSellerPayout = (orderId: string) => invokeOrderAction('release-seller-payout', { orderId });
export const markShipped = (orderId: string, carrier: string, trackingNumber: string) =>
  invokeOrderAction('mark-shipped', { orderId, carrier, trackingNumber, shippedAt: new Date().toISOString() });
export const submitShipmentTracking = (orderId: string, carrier: string, trackingNumber: string) =>
  invokeOrderAction('submit-shipment-tracking', { orderId, carrier, trackingNumber });

export async function issuePickupProof(orderId: string): Promise<{ proof: PickupProof; pin: string; expiresAt: string }> {
  const { data, error } = await requireSupabase().rpc('issue_pickup_proof', { p_order_id: orderId }).single();
  const row = data as Record<string, unknown> | null;
  if (error || !row || typeof row.token !== 'string' || typeof row.pin !== 'string' || typeof row.buyer_id !== 'string' || typeof row.expires_at !== 'string') {
    throw new Error('Pickup QR could not be generated.');
  }
  return {
    proof: { orderId, buyerId: row.buyer_id, token: row.token }, pin: row.pin,
    expiresAt: row.expires_at,
  };
}

export async function uploadDisputeEvidence(buyerId: string, orderId: string, uris: string[]) {
  const paths: string[] = [];
  for (let index = 0; index < uris.length; index += 1) {
    const response = await fetch(uris[index]);
    if (!response.ok) throw new Error('Could not read dispute evidence.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Each evidence photo must be 8 MB or smaller.');
    const mime = response.headers.get('content-type')?.toLowerCase() ?? 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mime)) {
      throw new Error('Use JPEG, PNG, WebP, HEIC, or HEIF evidence photos.');
    }
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
    const path = `${buyerId}/${orderId}/${Date.now()}-${index}.${extension}`;
    const { error } = await requireSupabase().storage.from('dispute-evidence')
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (error) throw error;
    paths.push(path);
  }
  return paths;
}

export async function fetchOrder(orderId: string): Promise<MarketplaceOrderRow> {
  const { data, error } = await requireSupabase().from('orders').select(ORDER_COLUMNS)
    .eq('id', orderId).single();
  if (error) throw error;
  return (await attachOrderImageUrls([data as MarketplaceOrderRow]))[0];
}

export async function fetchOrders(role: 'buyer' | 'seller', userId: string, page = 0) {
  const from = page * PAGE_SIZE;
  const column = role === 'buyer' ? 'buyer_id' : 'seller_id';
  const { data, error } = await requireSupabase().from('orders').select(ORDER_COLUMNS)
    .eq(column, userId).order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE);
  if (error) throw error;
  const rows = await attachOrderImageUrls((data ?? []) as MarketplaceOrderRow[]);
  return { items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

async function attachOrderImageUrls(rows: MarketplaceOrderRow[]) {
  const snapshots = [...new Set(rows.flatMap((row) =>
    row.listing_image_snapshot ? [row.listing_image_snapshot] : []))];
  const storagePaths = snapshots.filter((value) => !/^https?:\/\//i.test(value));
  const signedByPath = new Map<string, string>();
  if (storagePaths.length) {
    const { data } = await requireSupabase().storage.from('listing-images')
      .createSignedUrls(storagePaths, 60 * 60);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
  }
  return rows.map((row) => ({
    ...row,
    listing_image_url: row.listing_image_snapshot
      ? /^https?:\/\//i.test(row.listing_image_snapshot)
        ? row.listing_image_snapshot
        : signedByPath.get(row.listing_image_snapshot) ?? null
      : null,
  }));
}

function isCheckoutInitialization(value: unknown): value is CheckoutInitialization {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const summary = row.summary as Record<string, unknown> | undefined;
  return typeof row.orderId === 'string'
    && typeof row.paymentIntentClientSecret === 'string'
    && typeof row.reservationExpiresAt === 'string'
    && Boolean(summary)
    && typeof summary?.totalAmount === 'number'
    && summary?.currency === 'usd';
}

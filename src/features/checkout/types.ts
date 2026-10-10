export type FulfillmentType = 'pickup' | 'shipping';

export interface ShippingDestinationInput {
  recipientName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: 'US';
}

export interface OrderShippingDestinationRow {
  recipient_name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  region: string;
  postal_code: string;
  country_code: 'US';
  validation_source: 'shedmo_structural';
}

export interface CheckoutSummary {
  title: string;
  image: string | null;
  itemAmount: number;
  shippingAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: 'usd';
  fulfillmentType: FulfillmentType;
}

export interface CheckoutInitialization {
  orderId: string;
  paymentIntentClientSecret: string;
  summary: CheckoutSummary;
  reservationExpiresAt: string;
}

export interface MarketplaceOrderRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  fulfillment_type: FulfillmentType;
  payment_status: string;
  fulfillment_status: string;
  item_amount: number;
  shipping_amount: number;
  tax_amount: number;
  total_amount: number;
  marketplace_fee_amount: number;
  actual_processing_amount: number | null;
  reserve_withheld_amount: number;
  currency: string;
  listing_title_snapshot: string;
  listing_image_snapshot: string | null;
  listing_image_url: string | null;
  reservation_expires_at: string | null;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  pickup_confirmed_at: string | null;
  completed_at: string | null;
  inspection_expires_at: string | null;
  payout_eligible_at: string | null;
  payout_not_before: string | null;
  ship_by_at: string | null;
  ship_by_timezone: string | null;
  ship_by_timezone_source: 'listing_location' | 'platform_fallback' | null;
  shipping_workflow_version: 1 | 2 | 3;
  cancellation_reason: string | null;
  refund_status: string;
  dispute_status: string;
  transfer_status: string;
  seller_transfer_amount: number | null;
  order_shipments?: OrderShipmentRow | OrderShipmentRow[] | null;
  seller_payout_releases?: PayoutReleaseRow | PayoutReleaseRow[] | null;
  order_disputes?: OrderDisputeRow | OrderDisputeRow[] | null;
  order_refunds?: OrderRefundRow | OrderRefundRow[] | null;
  order_shipping_destinations?: OrderShippingDestinationRow | OrderShippingDestinationRow[] | null;
  created_at: string;
}

export interface OrderDisputeRow {
  id: string;
  dispute_type: string;
  status: string;
  buyer_explanation: string | null;
  seller_response: string | null;
  opened_at: string;
  resolved_at: string | null;
}

export interface OrderRefundRow {
  amount: number;
  currency: string;
  reason: string;
  status: string;
  succeeded_at: string | null;
}

export interface OrderShipmentRow {
  carrier: string;
  tracking_number: string;
  shipped_at: string | null;
  delivered_at: string | null;
  shipment_state?: string;
  status_source?: string;
  tracking_submitted_at?: string | null;
  carrier_accepted_at?: string | null;
}

export interface PayoutReleaseRow {
  amount: number;
  currency: string;
  status: 'pending' | 'creating' | 'reconciling' | 'transferred' | 'settled' | 'failed';
  transferred_at: string | null;
  processing_fee_amount: number;
  refund_deduction_amount: number;
  financial_adjustment_amount: number;
}

export interface PickupProof {
  orderId: string;
  buyerId: string;
  token: string;
}

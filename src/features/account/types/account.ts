export type OrderState = 'active' | 'completed' | 'cancelled';
export type OrderRole = 'buyer' | 'seller';
export type DeliveryMethod = 'shipping' | 'pickup';

export interface MarketplaceOrder {
  id: string;
  listingId: string;
  role: OrderRole;
  state: OrderState;
  status: string;
  price: number;
  serviceFee: number;
  shippingCost: number;
  otherPartyName: string;
  otherPartyInitials: string;
  sellerId: string;
  deliveryMethod: DeliveryMethod;
  orderDate: string;
  trackingNumber?: string;
  carrier?: string;
}

export interface MarketplaceReview {
  id: string;
  sellerId: string;
  orderId: string;
  listingId: string;
  reviewerName: string;
  reviewerInitials: string;
  rating: number;
  text: string;
  date: string;
}

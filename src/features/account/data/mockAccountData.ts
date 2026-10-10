// Synthetic prototype fixtures; no real customers, orders, or tracking records.
import type { MarketplaceOrder, MarketplaceReview } from '@/features/account/types/account';

export const mockOrders: MarketplaceOrder[] = [
  { id: 'purchase-1', listingId: '2', role: 'buyer', state: 'active', status: 'In transit', price: 340, serviceFee: 17, shippingCost: 18, otherPartyName: 'Demo Member Two', otherPartyInitials: 'MT', sellerId: 's2', deliveryMethod: 'shipping', orderDate: 'Jul 27, 2026', trackingNumber: 'DEMO-NOT-A-REAL-TRACKING-NUMBER', carrier: 'FedEx' },
  { id: 'purchase-2', listingId: '3', role: 'buyer', state: 'completed', status: 'Delivered', price: 295, serviceFee: 15, shippingCost: 0, otherPartyName: 'Demo Member Three', otherPartyInitials: 'TW', sellerId: 's3', deliveryMethod: 'pickup', orderDate: 'Jul 10, 2026' },
  { id: 'purchase-3', listingId: '6', role: 'buyer', state: 'cancelled', status: 'Cancelled', price: 475, serviceFee: 24, shippingCost: 0, otherPartyName: 'Demo Member Five', otherPartyInitials: 'AP', sellerId: 's5', deliveryMethod: 'pickup', orderDate: 'Jun 28, 2026' },
  { id: 'sale-1', listingId: '1', role: 'seller', state: 'active', status: 'Ready to ship', price: 175, serviceFee: 9, shippingCost: 0, otherPartyName: 'Demo Member Six', otherPartyInitials: 'SM', sellerId: 's1', deliveryMethod: 'shipping', orderDate: 'Jul 28, 2026' },
  { id: 'sale-2', listingId: '1', role: 'seller', state: 'completed', status: 'Delivered', price: 189, serviceFee: 9, shippingCost: 0, otherPartyName: 'Demo Member Seven', otherPartyInitials: 'CM', sellerId: 's1', deliveryMethod: 'pickup', orderDate: 'Jun 14, 2026' },
  { id: 'sale-3', listingId: '1', role: 'seller', state: 'cancelled', status: 'Cancelled', price: 180, serviceFee: 9, shippingCost: 0, otherPartyName: 'Demo Member Eight', otherPartyInitials: 'TR', sellerId: 's1', deliveryMethod: 'shipping', orderDate: 'May 30, 2026' },
];

export const mockReviews: MarketplaceReview[] = [];

export type PushPermissionState = 'unknown' | 'granted' | 'denied' | 'unavailable';

export interface MarketplacePushPayload {
  type: 'new_message' | 'listing_favorited' | 'local_sale_confirmation';
  notificationId: string;
  conversationId?: string;
  listingId?: string;
  actorId?: string;
}

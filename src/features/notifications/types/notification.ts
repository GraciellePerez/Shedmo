export type NotificationType = 'new_message' | 'listing_favorited' | 'local_sale_confirmation';
export type NotificationFilter = 'all' | 'messages' | 'favorites';

export interface DatabaseNotification {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  listing_id: string | null;
  conversation_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface MarketplaceNotification {
  id: string;
  userId: string;
  actorId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  listingId: string | null;
  conversationId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: MarketplaceNotification[];
  hasMore: boolean;
  nextPage: number;
}

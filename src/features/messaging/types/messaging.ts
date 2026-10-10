import type { Listing } from '@/models';

export type ConversationFilter = 'all' | 'buying' | 'selling';
export type ConversationRelationship = 'buying' | 'selling';
export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'countered';
export type OfferAction = Exclude<OfferStatus, 'pending'>;

interface MessageBase {
  id: string;
  fromMe: boolean;
  time: string;
  createdAt?: string;
}

export interface TextMessage extends MessageBase {
  kind: 'text';
  text: string;
}

export interface ImageMessage extends MessageBase {
  kind: 'image';
  attachmentPath: string;
  text?: string;
}

export interface OfferMessage extends MessageBase {
  kind: 'offer';
  offer: {
    amount: number;
    listingPrice: number;
    status: OfferStatus;
  };
}

export type MarketplaceMessage = TextMessage | ImageMessage | OfferMessage;

export interface ConversationParticipant {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  avatarUrl?: string;
}

export interface MarketplaceConversation {
  id: string;
  buyerId: string;
  sellerId: string;
  participant: ConversationParticipant;
  relationship: ConversationRelationship;
  listing: Pick<Listing, 'id' | 'title' | 'image' | 'price' | 'pickup'> & { unavailable?: boolean };
  messages: MarketplaceMessage[];
  unread: number;
  updatedAt: number;
  timeAgo: string;
}

export interface DatabaseMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  attachment_path: string | null;
  attachment_mime_type: string | null;
  attachment_size_bytes: number | null;
  moderation_hidden_at: string | null;
}

export interface MessagePage {
  items: MarketplaceMessage[];
  hasMore: boolean;
  nextPage: number;
}

export interface ConversationPage {
  items: MarketplaceConversation[];
  hasMore: boolean;
  nextPage: number;
}

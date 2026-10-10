import type { Listing } from '@/models';

export interface FavoriteRecord {
  user_id: string;
  listing_id: string;
  created_at: string;
}

export interface FavoriteListing {
  listing: Listing;
  status: 'active' | 'sold';
  savedAt: string;
}

export interface FavoriteListingPage {
  items: FavoriteListing[];
  nextPage: number;
  hasMore: boolean;
}


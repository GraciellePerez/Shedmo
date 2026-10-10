import type { DatabaseListingCategory, DatabaseListingCondition } from '@/features/listings/types/listing';
import type { Listing } from '@/models';

export type ListingSortOption = 'relevance' | 'newest' | 'closest' | 'price_asc' | 'price_desc';
export type ListingRadius = 10 | 25 | 50 | 100 | 250 | null;
export type ListingFulfillmentFilter = 'all' | 'pickup' | 'shipping';

export interface ListingSearchFilters {
  query: string;
  category: DatabaseListingCategory | null;
  condition: DatabaseListingCondition | null;
  minPrice: string;
  maxPrice: string;
  radius: ListingRadius;
  fulfillment: ListingFulfillmentFilter;
  sort: ListingSortOption;
}

export interface ListingSearchCursor {
  createdAt: string;
  id: string;
  price: number;
  distance: number | null;
  score: number;
}

export interface ListingSearchPage {
  items: Listing[];
  cursor: ListingSearchCursor | null;
  hasMore: boolean;
}

export const initialListingSearchFilters: ListingSearchFilters = {
  query: '',
  category: null,
  condition: null,
  minPrice: '',
  maxPrice: '',
  radius: null,
  fulfillment: 'all',
  sort: 'relevance',
};

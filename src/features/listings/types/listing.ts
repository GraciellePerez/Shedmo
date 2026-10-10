import type { Listing } from '@/models';

export type DatabaseListingStatus = 'draft' | 'active' | 'reserved' | 'pending_local_confirmation' | 'sold' | 'expired' | 'archived';
export type DatabaseListingCondition = 'new' | 'like_new' | 'good' | 'fair' | 'for_parts';
export type DatabaseListingCategory =
  | 'tools' | 'auto_parts' | 'tool_storage' | 'equipment'
  | 'marine' | 'outdoor_power' | 'shop_equipment' | 'supplies';

export interface DatabaseListingImage {
  id: string;
  listing_id: string;
  storage_path: string;
  sort_order: number;
  created_at: string;
}

export interface DatabaseListing {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  brand: string | null;
  price: number | string;
  category: DatabaseListingCategory;
  condition: DatabaseListingCondition;
  status: DatabaseListingStatus;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  postal_code: string | null;
  location_source: 'device' | 'manual' | 'profile' | null;
  location_updated_at: string | null;
  distance_miles?: number | null;
  pickup_available: boolean;
  shipping_available: boolean;
  shipping_price: number | string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
  listing_images?: DatabaseListingImage[];
  seller?: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    city: string | null;
    state: string | null;
    created_at: string;
  } | null;
}

export interface ListingPage {
  hasMore: boolean;
  items: Listing[];
  nextPage: number;
}

export interface ListingWriteProgress {
  completed: number;
  total: number;
}

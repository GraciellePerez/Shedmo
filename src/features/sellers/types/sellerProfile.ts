import type { Listing } from '@/models';

export interface PublicSellerProfile {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  memberSince: string;
  activeListingCount: number;
  soldListingCount: number;
  verifiedSalesCount: number;
  averageRating: number | null;
  totalReviews: number;
}

export interface SellerListingPage {
  items: Listing[];
  hasMore: boolean;
  nextPage: number;
}

export interface DatabasePublicSellerProfile {
  seller_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  member_since: string;
  active_listing_count: number | string;
  sold_listing_count: number | string;
  verified_sales_count: number | string;
  average_rating: number | string | null;
  total_reviews: number | string;
}

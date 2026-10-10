import { fetchPublicSellerListings } from '@/features/listings/services/listingRepository';
import { fetchProfileReviews } from '@/features/reviews/reviewRepository';
import type {
  DatabasePublicSellerProfile, PublicSellerProfile,
} from '@/features/sellers/types/sellerProfile';
import { requireSupabase } from '@/lib/supabase/client';

export async function fetchPublicSellerProfile(sellerId: string): Promise<PublicSellerProfile | null> {
  const [{ data, error }, reviews] = await Promise.all([
    requireSupabase()
      .rpc('get_public_seller_profile_v2', { p_seller_id: sellerId })
      .maybeSingle(),
    fetchProfileReviews(sellerId),
  ]);
  if (error) {
    if (__DEV__) console.info('[seller:profile:error]', { sellerId, code: error.code });
    throw error;
  }
  if (!data) return null;
  const row = data as DatabasePublicSellerProfile;
  const averageRating = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : null;
  return {
    id: row.seller_id,
    displayName: row.display_name?.trim() || row.username?.trim() || 'Shedmo Seller',
    username: row.username,
    avatarUrl: row.avatar_url,
    bio: row.bio?.trim() || null,
    city: row.city,
    state: row.state,
    memberSince: row.member_since,
    activeListingCount: Number(row.active_listing_count),
    soldListingCount: Number(row.sold_listing_count),
    verifiedSalesCount: Number(row.verified_sales_count),
    averageRating,
    totalReviews: reviews.length,
  };
}

export { fetchPublicSellerListings };

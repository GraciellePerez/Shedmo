import { requireSupabase } from '@/lib/supabase/client';
import { telemetry } from '@/services/telemetry';
import type { MarketplaceReview, OrderReviewStatus } from './types';

export async function submitMarketplaceReview(orderId: string, rating: number, body: string) {
  const { data, error } = await requireSupabase().rpc('submit_marketplace_review', {
    p_order_id: orderId, p_rating: rating, p_body: body.trim() || null,
  });
  if (error) throw error;
  telemetry.track('review_submitted', 'order', orderId);
  return data as string;
}

export async function fetchOrderReviewStatus(orderId: string): Promise<OrderReviewStatus> {
  const { data, error } = await requireSupabase().rpc('get_order_review_status', { p_order_id: orderId }).single();
  if (error) throw error;
  const row = data as Record<string, unknown>;
  return { eligible: row.eligible === true, reviewed: row.reviewed === true, direction: row.direction as OrderReviewStatus['direction'] };
}

export async function fetchProfileReviews(profileId: string): Promise<MarketplaceReview[]> {
  const { data, error } = await requireSupabase().rpc('get_profile_reviews', {
    p_profile_id: profileId, p_limit: 50, p_offset: 0,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.review_id), reviewerId: String(row.reviewer_id),
    reviewerName: String(row.reviewer_name), reviewerAvatarUrl: row.reviewer_avatar_url as string | null,
    direction: row.direction as MarketplaceReview['direction'], rating: Number(row.rating),
    body: row.body as string | null, createdAt: String(row.created_at),
  }));
}

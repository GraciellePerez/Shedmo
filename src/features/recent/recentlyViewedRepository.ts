import { requireSupabase } from '@/lib/supabase/client';

export async function recordRecentlyViewed(listingId: string) {
  const { error } = await requireSupabase().rpc('record_recent_listing_view', { p_listing_id: listingId });
  if (error && __DEV__) console.info('[recently-viewed:record:error]', { code: error.code });
}

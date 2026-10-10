import { requireSupabase } from '@/lib/supabase/client';

export async function isListingCheckoutEligible(listingId: string) {
  const { data, error } = await requireSupabase().rpc('is_listing_checkout_eligible', {
    p_listing_id: listingId,
  });
  if (error) throw error;
  return data === true;
}

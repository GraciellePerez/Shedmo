import { fetchBlockedSellerFilter } from '@/features/blocking/blockingRepository';
import { mapDatabaseListing } from '@/features/listings/services/listingRepository';
import type { DatabaseListing } from '@/features/listings/types/listing';
import type {
  FavoriteListing, FavoriteListingPage, FavoriteRecord,
} from '@/features/favorites/types/favorite';
import { requireSupabase } from '@/lib/supabase/client';
import { telemetry } from '@/services/telemetry';

const PAGE_SIZE = 12;
const FAVORITE_ID_PAGE_SIZE = 200;
const favoriteListingSelect = `
  created_at,
  listing:listings!favorites_listing_id_fkey (
    *,
    listing_images (*),
    seller:profiles!listings_seller_id_fkey (
      id, display_name, username, avatar_url, city, state, created_at
    )
  )
`;

export async function fetchFavorites(userId: string): Promise<FavoriteRecord[]> {
  const records: FavoriteRecord[] = [];
  for (let from = 0; ; from += FAVORITE_ID_PAGE_SIZE) {
    const { data, error } = await requireSupabase().from('favorites')
      .select('user_id,listing_id,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('listing_id', { ascending: false })
      .range(from, from + FAVORITE_ID_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as FavoriteRecord[];
    records.push(...page);
    if (page.length < FAVORITE_ID_PAGE_SIZE) return records;
  }
}

export async function fetchFavoriteListingIds(userId: string) {
  const records = await fetchFavorites(userId);
  return records.map((record) => record.listing_id);
}

export async function isListingFavorited(userId: string, listingId: string) {
  const { data, error } = await requireSupabase().from('favorites').select('listing_id')
    .eq('user_id', userId).eq('listing_id', listingId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function addFavorite(userId: string, listingId: string) {
  const { error } = await requireSupabase().from('favorites')
    .upsert(
      { user_id: userId, listing_id: listingId },
      { onConflict: 'user_id,listing_id', ignoreDuplicates: true },
    );
  if (error) throw error;
  telemetry.track('listing_saved', 'listing', listingId);
}

export async function removeFavorite(userId: string, listingId: string) {
  const { error } = await requireSupabase().from('favorites').delete()
    .eq('user_id', userId).eq('listing_id', listingId);
  if (error) throw error;
}

export async function toggleFavorite(userId: string, listingId: string) {
  if (await isListingFavorited(userId, listingId)) {
    await removeFavorite(userId, listingId);
    return false;
  }
  await addFavorite(userId, listingId);
  return true;
}

export async function fetchFavoriteListings(userId: string, page = 0): Promise<FavoriteListingPage> {
  const from = page * PAGE_SIZE;
  const blocked = await fetchBlockedSellerFilter();
  let query = requireSupabase().from('favorites')
    .select(blocked ? favoriteListingSelect.replace('!favorites_listing_id_fkey', '!favorites_listing_id_fkey!inner') : favoriteListingSelect)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('listing_id', { ascending: false })
    .range(from, from + PAGE_SIZE);
  if (blocked) query = query.not('listing.seller_id', 'in', blocked);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    created_at: string;
    listing: DatabaseListing | null;
  }[];
  const visible = rows.slice(0, PAGE_SIZE).filter(
    (row): row is { created_at: string; listing: DatabaseListing } =>
      Boolean(row.listing && (row.listing.status === 'active' || row.listing.status === 'sold')),
  );
  return {
    items: await Promise.all(visible.map(async (row) => ({
      listing: await mapDatabaseListing(row.listing),
      status: row.listing.status as 'active' | 'sold',
      savedAt: row.created_at,
    }))),
    hasMore: rows.length > PAGE_SIZE,
    nextPage: page + 1,
  };
}

export async function fetchFavoriteListing(
  userId: string,
  listingId: string,
): Promise<FavoriteListing | null> {
  const blocked = await fetchBlockedSellerFilter();
  let query = requireSupabase().from('favorites')
    .select(blocked ? favoriteListingSelect.replace('!favorites_listing_id_fkey', '!favorites_listing_id_fkey!inner') : favoriteListingSelect)
    .eq('user_id', userId)
    .eq('listing_id', listingId);
  if (blocked) query = query.not('listing.seller_id', 'in', blocked);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;

  const row = data as unknown as {
    created_at: string;
    listing: DatabaseListing | null;
  } | null;
  if (!row?.listing || (row.listing.status !== 'active' && row.listing.status !== 'sold')) {
    return null;
  }
  return {
    listing: await mapDatabaseListing(row.listing),
    status: row.listing.status,
    savedAt: row.created_at,
  };
}

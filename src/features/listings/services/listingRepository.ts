import { fetchBlockedSellerFilter } from '@/features/blocking/blockingRepository';
import type { ListingCondition, Listing, SellerInfo } from '@/models';
import {
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_DESCRIPTION_MIN_LENGTH,
  LISTING_TITLE_MAX_LENGTH,
  LISTING_TITLE_MIN_LENGTH,
  listingDescriptionLength,
  listingTitleLength,
  normalizeListingDescription,
  normalizeListingTitle,
  type ListingDraft,
  type ListingDraftPhoto,
} from '@/features/sell/types/listingDraft';
import type {
  DatabaseListing, DatabaseListingCondition,
  DatabaseListingImage, DatabaseListingStatus, ListingPage, ListingWriteProgress,
} from '@/features/listings/types/listing';
import { requireSupabase } from '@/lib/supabase/client';
import { telemetry } from '@/services/telemetry';
import type {
  ListingSearchCursor, ListingSearchFilters, ListingSearchPage,
} from '@/features/browse/types/search';
import {
  normalizeCity, normalizePostalCode, normalizeState, validateManualLocation,
} from '@/features/location/locationValidation';
import { formatDistanceMiles } from '@/features/location/formatDistance';
import {
  LISTING_CATEGORY_BY_LABEL,
  LISTING_CATEGORY_LABELS,
} from '@/features/listings/categoryLabels';
import { PUBLIC_SHIPPING_ENABLED } from '@/config/launchFeatures';

const BUCKET = 'listing-images';
const PAGE_SIZE = 12;
const SEARCH_PAGE_SIZE = 20;
const SELLER_PAGE_SIZE = 20;
const MAX_PHOTOS = 12;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const SIGNED_URL_TTL_MS = 50 * 60 * 1000;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const listingSelect = `*, listing_images (*), seller:profiles!listings_seller_id_fkey (id, display_name, username, avatar_url, city, state, created_at)`;
const signedUrlCache = new Map<string, { expiresAt: number; url: string }>();
const signedUrlRequests = new Map<string, Promise<string | null>>();
const pendingSignedUrls = new Map<string, {
  generation: number;
  path: string;
  reject: (reason?: unknown) => void;
  resolve: (url: string | null) => void;
}>();
let signedUrlFlushScheduled = false;
let signedUrlCacheGeneration = 0;

const conditionToDb: Record<ListingCondition, DatabaseListingCondition> = {
  New: 'new', 'Like New': 'like_new', Good: 'good', Fair: 'fair', 'For Parts': 'for_parts',
};
const conditionLabel: Record<DatabaseListingCondition, ListingCondition> = {
  new: 'New', like_new: 'Like New', good: 'Good', fair: 'Fair', for_parts: 'For Parts',
};

export async function fetchActiveListings(page = 0): Promise<ListingPage> {
  const from = page * PAGE_SIZE;
  const blocked = await fetchBlockedSellerFilter();
  let query = requireSupabase().from('listings').select(listingSelect)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE_SIZE);
  if (!PUBLIC_SHIPPING_ENABLED) query = query.eq('pickup_available', true);
  if (blocked) query = query.not('seller_id', 'in', blocked);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as DatabaseListing[];
  return {
    items: await Promise.all(rows.slice(0, PAGE_SIZE).map(mapDatabaseListing)),
    hasMore: rows.length > PAGE_SIZE,
    nextPage: page + 1,
  };
}

export async function fetchNearbyListings(
  latitude: number,
  longitude: number,
  page = 0,
  radiusMiles: 5 | 10 | 25 | 50 | 100 | null = null,
  sort: 'nearest' | 'newest' = 'nearest',
): Promise<ListingPage> {
  const { data: matches, error: rpcError } = await requireSupabase().rpc('nearby_listings', {
    p_latitude: latitude,
    p_longitude: longitude,
    p_radius_miles: radiusMiles,
    p_limit: PAGE_SIZE + 1,
    p_offset: page * PAGE_SIZE,
    p_sort: sort,
  });
  if (rpcError) throw rpcError;
  const pageMatches = (matches ?? []).slice(0, PAGE_SIZE) as {
    listing_id: string; distance_miles: number;
  }[];
  if (!pageMatches.length) return { items: [], hasMore: false, nextPage: page + 1 };
  const ids = pageMatches.map((item) => item.listing_id);
  const { data, error } = await requireSupabase().from('listings').select(listingSelect).in('id', ids);
  if (error) throw error;
  const byId = new Map(((data ?? []) as unknown as DatabaseListing[]).map((row) => [row.id, row]));
  const items = await Promise.all(pageMatches.flatMap((match) => {
    const row = byId.get(match.listing_id);
    return row && (PUBLIC_SHIPPING_ENABLED || row.pickup_available)
      ? [mapDatabaseListing({ ...row, distance_miles: match.distance_miles })] : [];
  }));
  return { items, hasMore: (matches ?? []).length > PAGE_SIZE, nextPage: page + 1 };
}

export async function searchListings(
  filters: ListingSearchFilters,
  cursor: ListingSearchCursor | null,
  location: { latitude: number; longitude: number } | null,
): Promise<ListingSearchPage> {
  const query = filters.query.trim();
  const minPrice = filters.minPrice.trim() ? Number(filters.minPrice) : null;
  const maxPrice = filters.maxPrice.trim() ? Number(filters.maxPrice) : null;
  const { data: matches, error: rpcError } = await requireSupabase().rpc(
    'search_marketplace_listings_v3',
    {
      p_query: query || null,
      p_category: filters.category,
      p_condition: filters.condition,
      p_min_price: minPrice,
      p_max_price: maxPrice,
      p_latitude: location?.latitude ?? null,
      p_longitude: location?.longitude ?? null,
      p_radius_miles: filters.radius,
      p_fulfillment: PUBLIC_SHIPPING_ENABLED ? filters.fulfillment : 'pickup',
      p_sort: filters.sort,
      p_limit: SEARCH_PAGE_SIZE + 1,
      p_cursor_created_at: cursor?.createdAt ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_cursor_price: cursor?.price ?? null,
      p_cursor_distance: cursor?.distance ?? null,
      p_cursor_score: cursor?.score ?? null,
    },
  );
  if (rpcError) {
    if (__DEV__) console.info('[listing:search:error]', { code: rpcError.code });
    throw rpcError;
  }
  const rows = (matches ?? []) as {
    listing_id: string; distance_miles: number | null; cursor_created_at: string; cursor_price: number | string;
    cursor_score: number;
  }[];
  const pageRows = rows.slice(0, SEARCH_PAGE_SIZE);
  if (!pageRows.length) return { items: [], cursor: null, hasMore: false };
  const { data, error } = await requireSupabase().from('listings')
    .select(listingSelect).in('id', pageRows.map((row) => row.listing_id));
  if (error) throw error;
  const byId = new Map(((data ?? []) as unknown as DatabaseListing[]).map((row) => [row.id, row]));
  const items = await Promise.all(pageRows.flatMap((match) => {
    const listing = byId.get(match.listing_id);
    return listing ? [mapDatabaseListing({ ...listing, distance_miles: match.distance_miles })] : [];
  }));
  const last = pageRows.at(-1)!;
  if (__DEV__) {
    console.info('[listing:search]', {
      queryLength: query.length,
      activeFilters: Object.entries(filters).filter(([, value]) => value != null && value !== '').map(([key]) => key),
      sort: filters.sort,
      pageSize: SEARCH_PAGE_SIZE,
      hasCoordinates: Boolean(location),
    });
  }
  return {
    items,
    hasMore: rows.length > SEARCH_PAGE_SIZE,
    cursor: {
      id: last.listing_id,
      createdAt: last.cursor_created_at,
      price: Number(last.cursor_price),
      distance: last.distance_miles,
      score: last.cursor_score,
    },
  };
}

export async function fetchListingById(id: string) {
  const blocked = await fetchBlockedSellerFilter();
  let query = requireSupabase().from('listings').select(listingSelect).eq('id', id);
  if (blocked) query = query.not('seller_id', 'in', blocked);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapDatabaseListing(data as unknown as DatabaseListing) : null;
}

export async function fetchRecentlyViewedListings(): Promise<Listing[]> {
  const { data: history, error: historyError } = await requireSupabase()
    .from('recently_viewed_listings').select('listing_id,viewed_at')
    .order('viewed_at', { ascending: false }).limit(12);
  if (historyError) throw historyError;
  const ids = (history ?? []).map((row) => row.listing_id as string);
  if (!ids.length) return [];
  const blocked = await fetchBlockedSellerFilter();
  let query = requireSupabase().from('listings').select(listingSelect)
    .in('id', ids).eq('status', 'active');
  if (!PUBLIC_SHIPPING_ENABLED) query = query.eq('pickup_available', true);
  if (blocked) query = query.not('seller_id', 'in', blocked);
  const { data, error } = await query;
  if (error) throw error;
  const byId = new Map(((data ?? []) as unknown as DatabaseListing[]).map((row) => [row.id, row]));
  return Promise.all(ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [mapDatabaseListing(row)] : [];
  }));
}

export async function fetchListingDistance(
  listingId: string,
  latitude: number,
  longitude: number,
) {
  const { data, error } = await requireSupabase().rpc('listing_distance_miles', {
    p_listing_id: listingId,
    p_latitude: latitude,
    p_longitude: longitude,
  });
  if (error) throw error;
  return data == null ? null : Number(data);
}

export async function fetchSellerListings(sellerId: string, activeOnly = false) {
  const blocked = await fetchBlockedSellerFilter();
  let query = requireSupabase().from('listings').select(listingSelect)
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);
  if (activeOnly) query = query.eq('status', 'active');
  if (blocked) query = query.not('seller_id', 'in', blocked);
  const { data, error } = await query;
  if (error) throw error;
  return Promise.all(((data ?? []) as unknown as DatabaseListing[]).map(mapDatabaseListing));
}

export async function fetchPublicSellerListings(sellerId: string, page = 0) {
  const from = page * SELLER_PAGE_SIZE;
  const blocked = await fetchBlockedSellerFilter();
  let query = requireSupabase().from('listings').select(listingSelect)
    .eq('seller_id', sellerId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + SELLER_PAGE_SIZE);
  if (!PUBLIC_SHIPPING_ENABLED) query = query.eq('pickup_available', true);
  if (blocked) query = query.not('seller_id', 'in', blocked);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as DatabaseListing[];
  return {
    items: await Promise.all(rows.slice(0, SELLER_PAGE_SIZE).map(mapDatabaseListing)),
    hasMore: rows.length > SELLER_PAGE_SIZE,
    nextPage: page + 1,
  };
}

export async function fetchManagedSellerListings(sellerId: string) {
  const { data, error } = await requireSupabase().from('listings').select(listingSelect)
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);
  if (error) throw error;
  return Promise.all(((data ?? []) as unknown as DatabaseListing[]).map(async (row) => ({
    listing: await mapDatabaseListing(row),
    status: row.status,
    saves: 0,
    messages: 0,
  })));
}

export async function createListing(
  sellerId: string,
  draft: ListingDraft,
  status: 'active' | 'draft',
  onProgress?: (progress: ListingWriteProgress) => void,
) {
  validatePhotos(draft.photos, status === 'active');
  if (!draft.category || !draft.condition) throw new Error('Category and condition are required.');
  const hasCoordinates = draft.latitude != null && draft.longitude != null;
  const hasCityState = Boolean(draft.city.trim() && draft.state.trim());
  if (status === 'active' && !hasCoordinates && !hasCityState) {
    throw new Error('Add a city and state or use your current location before publishing.');
  }
  if (hasCityState) {
    const locationError = validateManualLocation(draft.city, draft.state, draft.postalCode);
    if (locationError) throw new Error(locationError);
  }
  const client = requireSupabase();
  const title = normalizeListingTitle(draft.title);
  const titleLength = listingTitleLength(title);
  if (titleLength < LISTING_TITLE_MIN_LENGTH || titleLength > LISTING_TITLE_MAX_LENGTH) {
    throw new Error(
      `Title must be ${LISTING_TITLE_MIN_LENGTH}–${LISTING_TITLE_MAX_LENGTH} characters.`,
    );
  }
  const description = normalizeListingDescription(draft.description);
  const descriptionLength = listingDescriptionLength(description);
  if (
    descriptionLength < LISTING_DESCRIPTION_MIN_LENGTH
    || descriptionLength > LISTING_DESCRIPTION_MAX_LENGTH
  ) {
    throw new Error(
      `Description must be ${LISTING_DESCRIPTION_MIN_LENGTH}–${LISTING_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters.`,
    );
  }
  const pickupAvailable = PUBLIC_SHIPPING_ENABLED ? draft.pickup : true;
  const shippingAvailable = PUBLIC_SHIPPING_ENABLED ? draft.shipping : false;
  const insertPayload = {
    seller_id: sellerId, title, description,
    brand: draft.brand.trim() || null, price: Number(draft.price), category: LISTING_CATEGORY_BY_LABEL[draft.category],
    condition: conditionToDb[draft.condition], status: 'draft', city: normalizeCity(draft.city) || null,
    state: normalizeState(draft.state) || null, postal_code: normalizePostalCode(draft.postalCode) || null,
    latitude: draft.latitude, longitude: draft.longitude,
    location_source: hasCoordinates || hasCityState ? (draft.locationSource ?? 'manual') : null,
    pickup_available: pickupAvailable,
    shipping_available: shippingAvailable,
    shipping_price: shippingAvailable ? Number(draft.shippingPrice || 0) : null,
  };
  const { data, error } = await client.from('listings').insert(insertPayload).select('id').single();
  if (error) throw error;
  const listingId = (data as { id: string }).id;
  const uploadedPaths: string[] = [];
  try {
    const images = await uploadListingImages(sellerId, listingId, draft.photos, uploadedPaths, onProgress);
    if (images.length) {
      const { error: imageError } = await client.from('listing_images').insert(images);
      if (imageError) throw imageError;
    }
    if (status === 'active') {
      const { error: activateError } = await client.from('listings').update({ status }).eq('id', listingId);
      if (activateError) throw activateError;
    }
    const listing = await fetchListingById(listingId);
    if (!listing) throw new Error('The listing was saved but could not be reloaded.');
    telemetry.track('listing_created', 'listing', listingId, { category: listing.category, fulfillment_type: listing.pickup && listing.shipping ? 'both' : listing.pickup ? 'pickup' : 'shipping' });
    return listing;
  } catch (cause) {
    if (uploadedPaths.length) await client.storage.from(BUCKET).remove(uploadedPaths);
    await client.from('listings').delete().eq('id', listingId);
    throw cause;
  }
}

export async function updateListingStatus(id: string, status: DatabaseListingStatus) {
  const { error } = await requireSupabase().from('listings').update({ status }).eq('id', id);
  if (error) throw error;
  return fetchListingById(id);
}

export async function updateCurrentUserListing(
  id: string,
  changes: Partial<Pick<DatabaseListing, 'title' | 'description' | 'brand' | 'price' | 'category' | 'condition' | 'city' | 'state' | 'pickup_available' | 'shipping_available' | 'shipping_price'>>,
) {
  const normalizedChanges = { ...changes };
  if (changes.title !== undefined) {
    normalizedChanges.title = normalizeListingTitle(changes.title);
    const length = listingTitleLength(normalizedChanges.title);
    if (length < LISTING_TITLE_MIN_LENGTH || length > LISTING_TITLE_MAX_LENGTH) {
      throw new Error(
        `Title must be ${LISTING_TITLE_MIN_LENGTH}–${LISTING_TITLE_MAX_LENGTH} characters.`,
      );
    }
  }
  if (changes.description !== undefined) {
    normalizedChanges.description = normalizeListingDescription(changes.description);
    const length = listingDescriptionLength(normalizedChanges.description);
    if (length < LISTING_DESCRIPTION_MIN_LENGTH || length > LISTING_DESCRIPTION_MAX_LENGTH) {
      throw new Error(
        `Description must be ${LISTING_DESCRIPTION_MIN_LENGTH}–${LISTING_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters.`,
      );
    }
  }
  const { error } = await requireSupabase().from('listings').update(normalizedChanges).eq('id', id);
  if (error) throw error;
  return fetchListingById(id);
}

export async function deleteListingImages(listingId: string) {
  const client = requireSupabase();
  const { data, error } = await client.from('listing_images').select('storage_path').eq('listing_id', listingId);
  if (error) throw error;
  const paths = (data ?? []).map((row) => row.storage_path as string);
  if (paths.length) {
    const { error: storageError } = await client.storage.from(BUCKET).remove(paths);
    if (storageError) throw storageError;
  }
  const { error: metadataError } = await client.from('listing_images').delete().eq('listing_id', listingId);
  if (metadataError) throw metadataError;
}

export async function deleteListing(id: string) {
  const client = requireSupabase();
  await deleteListingImages(id);
  const { error: deleteError } = await client.from('listings').delete().eq('id', id);
  if (deleteError) throw deleteError;
}

export async function uploadListingImages(
  sellerId: string, listingId: string, photos: ListingDraftPhoto[], uploadedPaths: string[],
  onProgress?: (progress: ListingWriteProgress) => void,
) {
  const rows: Omit<DatabaseListingImage, 'id' | 'created_at'>[] = [];
  const uniquePhotos = [...new Map(photos.map((photo) => [photo.uri, photo])).values()];
  for (let index = 0; index < uniquePhotos.length; index += 1) {
    const photo = uniquePhotos[index];
    const response = await fetch(photo.uri);
    if (!response.ok) throw new Error(`Could not read photo ${index + 1}.`);
    const buffer = await response.arrayBuffer();
    const mime = normalizeMime(photo.mimeType ?? response.headers.get('content-type'));
    if (!ALLOWED_MIME.has(mime)) throw new Error('Use JPEG, PNG, WebP, HEIC, or HEIF photos.');
    if (buffer.byteLength > MAX_PHOTO_BYTES) throw new Error('Each photo must be 8 MB or smaller.');
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
    const path = `${sellerId}/${listingId}/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 12)}.${extension}`;
    const { error } = await requireSupabase().storage.from(BUCKET)
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (error) throw error;
    uploadedPaths.push(path);
    rows.push({ listing_id: listingId, storage_path: path, sort_order: index });
    onProgress?.({ completed: index + 1, total: uniquePhotos.length });
  }
  return rows;
}

export async function mapDatabaseListing(row: DatabaseListing): Promise<Listing> {
  const paths = [...(row.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => image.storage_path);
  const urls = await signedUrls(paths);
  const distanceMiles = row.latitude != null && row.longitude != null
    && row.distance_miles != null && Number.isFinite(Number(row.distance_miles))
    && Number(row.distance_miles) >= 0
    ? Number(row.distance_miles)
    : null;
  return {
    id: row.id, title: row.title, price: Number(row.price), condition: conditionLabel[row.condition],
    brand: row.brand ?? LISTING_CATEGORY_LABELS[row.category],
    location: [row.city, row.state].filter(Boolean).join(', ') || 'Location unavailable',
    distance: formatDistanceMiles(distanceMiles),
    distanceMiles,
    latitude: row.latitude, longitude: row.longitude, postalCode: row.postal_code ?? '',
    locationSource: row.location_source,
    image: urls[0] ?? '', images: urls, category: row.category, status: row.status,
    shipping: row.shipping_available, shippingCost: Number(row.shipping_price ?? 0),
    pickup: row.pickup_available, timeAgo: relativeTime(row.created_at), views: row.view_count,
    description: row.description, createdAt: row.created_at, seller: mapSeller(row), offerOk: true,
  };
}

async function signedUrls(paths: string[]) {
  if (!paths.length) return [];
  const urls = await Promise.all(paths.map(requestSignedUrl));
  return urls.filter((url): url is string => Boolean(url));
}

function requestSignedUrl(path: string): Promise<string | null> {
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);

  const generation = signedUrlCacheGeneration;
  const requestKey = `${generation}\u0000${path}`;
  const existing = signedUrlRequests.get(requestKey);
  if (existing) return existing;

  const request = new Promise<string | null>((resolve, reject) => {
    pendingSignedUrls.set(requestKey, { generation, path, reject, resolve });
  });
  signedUrlRequests.set(requestKey, request);

  if (!signedUrlFlushScheduled) {
    signedUrlFlushScheduled = true;
    void Promise.resolve().then(flushSignedUrlRequests);
  }
  return request;
}

async function flushSignedUrlRequests() {
  signedUrlFlushScheduled = false;
  const batch = [...pendingSignedUrls.entries()];
  pendingSignedUrls.clear();
  if (!batch.length) return;

  try {
    const { data, error } = await requireSupabase().storage
      .from(BUCKET)
      .createSignedUrls(batch.map(([, entry]) => entry.path), 3600);
    if (error) throw error;

    batch.forEach(([requestKey, entry], index) => {
      const url = data[index]?.signedUrl ?? null;
      if (url && entry.generation === signedUrlCacheGeneration) {
        signedUrlCache.set(entry.path, {
          expiresAt: Date.now() + SIGNED_URL_TTL_MS,
          url,
        });
      }
      entry.resolve(url);
      signedUrlRequests.delete(requestKey);
    });
  } catch (error) {
    batch.forEach(([requestKey, entry]) => {
      entry.reject(error);
      signedUrlRequests.delete(requestKey);
    });
  }
}

export function clearListingImageUrlCache() {
  signedUrlCacheGeneration += 1;
  signedUrlCache.clear();
}

function mapSeller(row: DatabaseListing): SellerInfo {
  const name = row.seller?.display_name?.trim() || row.seller?.username?.trim() || 'Shedmo Seller';
  const location = [row.seller?.city, row.seller?.state].filter(Boolean).join(', ')
    || [row.city, row.state].filter(Boolean).join(', ') || 'Location unavailable';
  return {
    id: row.seller_id, name,
    avatar: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    avatarUrl: row.seller?.avatar_url ?? undefined,
    verified: false, rating: 0, reviews: 0, sales: 0, location,
    responseTime: 'Response time unavailable',
    joined: row.seller?.created_at ? `${new Date(row.seller.created_at).getFullYear()}` : 'Recently',
  };
}

function validatePhotos(photos: ListingDraftPhoto[], required: boolean) {
  if (required && photos.length === 0) throw new Error('Add at least one photo before publishing.');
  if (photos.length > MAX_PHOTOS) throw new Error(`Add no more than ${MAX_PHOTOS} photos.`);
  if (new Set(photos.map((photo) => photo.uri)).size !== photos.length) {
    throw new Error('Remove duplicate photos before publishing.');
  }
  if (photos.some((photo) => photo.fileSize != null && photo.fileSize > MAX_PHOTO_BYTES)) {
    throw new Error('Each photo must be 8 MB or smaller.');
  }
}

function normalizeMime(value: string | null | undefined) {
  const mime = value?.split(';')[0].trim().toLowerCase();
  return mime && mime !== 'application/octet-stream' ? mime : 'image/jpeg';
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

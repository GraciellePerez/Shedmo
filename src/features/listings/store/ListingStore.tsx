import { useBlockingStore } from '@/features/blocking/BlockingStore';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import {
  clearListingImageUrlCache,
  createListing, deleteListing as deleteRemoteListing, fetchActiveListings,
  fetchListingById, fetchManagedSellerListings, fetchNearbyListings, updateListingStatus,
  updateCurrentUserListing,
} from '@/features/listings/services/listingRepository';
import type { ListingWriteProgress } from '@/features/listings/types/listing';
import type { ListingDraft } from '@/features/sell/types/listingDraft';
import type { ListingStatus } from '@/features/profile/types/profile';
import type { Listing } from '@/models';
import { useLocationStore } from '@/features/location/store/LocationStore';

export type BrowseRadius = 5 | 10 | 25 | 50 | 100 | null;
export type BrowseSort = 'newest' | 'nearest';

export interface ManagedListing {
  listing: Listing;
  status: ListingStatus;
  saves: number;
  messages: number;
}

interface ListingStoreValue {
  listings: Listing[];
  myListings: Listing[];
  managedListings: ManagedListing[];
  loading: boolean;
  loadingMore: boolean;
  myListingsLoading: boolean;
  error: string | null;
  hasMore: boolean;
  browseRadius: BrowseRadius;
  browseSort: BrowseSort;
  locationNotice: string | null;
  setBrowseOptions: (sort: BrowseSort, radius: BrowseRadius) => void;
  deleteListing: (listingId: string) => Promise<void>;
  getListingById: (listingId: string) => Promise<Listing | null>;
  refreshListingById: (listingId: string) => Promise<Listing | null>;
  loadMore: () => Promise<void>;
  publishDraft: (
    draft: ListingDraft,
    status?: 'active' | 'draft',
    onProgress?: (progress: ListingWriteProgress) => void,
  ) => Promise<Listing>;
  refresh: () => Promise<void>;
  refreshMyListings: () => Promise<void>;
  setListingStatus: (listingId: string, status: ListingStatus) => Promise<void>;
  updateListing: (listingId: string, changes: { title: string; description: string; price: number }) => Promise<void>;
}

const ListingStoreContext = createContext<ListingStoreValue | null>(null);

export function ListingStoreProvider({ children }: PropsWithChildren) {
  const { session } = useAuthStore();
  const { blockedIds, revision: blockingRevision } = useBlockingStore();
  const { location } = useLocationStore();
  const browsingLatitude = location?.latitude ?? null;
  const browsingLongitude = location?.longitude ?? null;
  const [remoteListings, setRemoteListings] = useState<Listing[]>([]);
  const [managedListings, setManagedListings] = useState<ManagedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [myListingsLoading, setMyListingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const managedGenerationRef = useRef(0);
  const detailGenerationRef = useRef(new Map<string, number>());
  const [browseSort, setBrowseSort] = useState<BrowseSort>('newest');
  const [browseRadius, setBrowseRadius] = useState<BrowseRadius>(null);
  const locationQuery = (browseSort === 'nearest' || browseRadius !== null)
    && browsingLatitude != null && browsingLongitude != null;
  const locationNotice = (browseSort === 'nearest' || browseRadius !== null) && !locationQuery
    ? 'Choose a current or manual browsing location to calculate distance.'
    : null;

  const refreshMyListings = useCallback(async () => {
    const generation = ++managedGenerationRef.current;
    const userId = session?.user.id;
    if (!userId) {
      setManagedListings([]);
      return;
    }
    setMyListingsLoading(true);
    try {
      const rows = await fetchManagedSellerListings(userId);
      if (generation === managedGenerationRef.current) {
        setManagedListings(rows as ManagedListing[]);
      }
    } catch {
      if (generation === managedGenerationRef.current) {
        setError('Your listings could not be loaded. Pull to retry.');
      }
    } finally {
      if (generation === managedGenerationRef.current) setMyListingsLoading(false);
    }
  }, [session?.user.id]);

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = locationQuery
        ? await fetchNearbyListings(
          browsingLatitude!, browsingLongitude!, 0, browseRadius, browseSort,
        )
        : await fetchActiveListings(0);
      if (generation !== refreshGenerationRef.current) return;
      pageRef.current = page.nextPage;
      setRemoteListings(page.items);
      setHasMore(page.hasMore);
    } catch {
      if (generation !== refreshGenerationRef.current) return;
      setRemoteListings([]);
      setHasMore(false);
      setError('Real listings could not be loaded. Check your connection and retry.');
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false);
    }
  }, [browseRadius, browseSort, browsingLatitude, browsingLongitude, locationQuery]);

  useEffect(() => {
    void Promise.all([refresh(), refreshMyListings()]);
    return () => {
      refreshGenerationRef.current += 1;
      loadMoreInFlightRef.current = false;
    };
  }, [refresh, refreshMyListings]);

  useEffect(() => {
    clearListingImageUrlCache();
  }, [session?.user.id]);

  const loadMore = useCallback(async () => {
    if (loadMoreInFlightRef.current || !hasMore) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    const generation = refreshGenerationRef.current;
    try {
      const page = locationQuery
        ? await fetchNearbyListings(
          browsingLatitude!, browsingLongitude!, pageRef.current, browseRadius, browseSort,
        )
        : await fetchActiveListings(pageRef.current);
      if (generation !== refreshGenerationRef.current) return;
      pageRef.current = page.nextPage;
      setRemoteListings((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setHasMore(page.hasMore);
    } catch {
      if (generation === refreshGenerationRef.current) {
        setError('More listings could not be loaded. Try again.');
      }
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  }, [
    browseRadius, browseSort, browsingLatitude, browsingLongitude,
    hasMore, locationQuery,
  ]);

  const setBrowseOptions = useCallback((sort: BrowseSort, radius: BrowseRadius) => {
    setBrowseSort(sort);
    setBrowseRadius(radius);
  }, []);

  const publishDraft = useCallback(async (
    draft: ListingDraft,
    status: 'active' | 'draft' = 'active',
    onProgress?: (progress: ListingWriteProgress) => void,
  ) => {
    const userId = session?.user.id;
    if (!userId) throw new Error('Sign in before saving a listing.');
    const listing = await createListing(userId, draft, status, onProgress);
    setManagedListings((current) => [
      { listing, status, saves: 0, messages: 0 },
      ...current.filter((item) => item.listing.id !== listing.id),
    ]);
    if (status === 'active') {
      setRemoteListings((current) => [
        listing,
        ...current.filter((item) => item.id !== listing.id),
      ]);
    }
    return listing;
  }, [session?.user.id]);

  const setListingStatus = useCallback(async (listingId: string, status: ListingStatus) => {
    const listing = await updateListingStatus(listingId, status);
    if (!listing) throw new Error('The listing is no longer available.');
    setManagedListings((current) => current.map((item) =>
      item.listing.id === listingId ? { ...item, listing, status } : item));
    setRemoteListings((current) => status === 'active'
      ? [listing, ...current.filter((item) => item.id !== listingId)]
      : current.filter((item) => item.id !== listingId));
  }, []);

  const deleteListing = useCallback(async (listingId: string) => {
    await deleteRemoteListing(listingId);
    setManagedListings((current) => current.filter((item) => item.listing.id !== listingId));
    setRemoteListings((current) => current.filter((item) => item.id !== listingId));
  }, []);

  const updateListing = useCallback(async (
    listingId: string,
    changes: { title: string; description: string; price: number },
  ) => {
    const listing = await updateCurrentUserListing(listingId, changes);
    if (!listing) throw new Error('The listing is no longer available.');
    setManagedListings((current) => current.map((item) =>
      item.listing.id === listingId ? { ...item, listing } : item));
    setRemoteListings((current) => current.map((item) =>
      item.id === listingId ? listing : item));
  }, []);

  const getListingById = useCallback(async (listingId: string) => {
    const cached = [...remoteListings, ...managedListings.map((item) => item.listing)]
      .find((item) => item.id === listingId);
    if (cached) return blockedIds.has(cached.seller.id) ? null : cached;
    return fetchListingById(listingId);
  }, [blockedIds, managedListings, remoteListings]);

  const refreshListingById = useCallback(async (listingId: string) => {
    const generation = (detailGenerationRef.current.get(listingId) ?? 0) + 1;
    detailGenerationRef.current.set(listingId, generation);
    const listing = await fetchListingById(listingId);
    if (detailGenerationRef.current.get(listingId) !== generation) return null;

    setManagedListings((current) => current.map((item) =>
      item.listing.id === listingId && listing
        ? {
          ...item,
          listing,
          status: listing.status === 'reserved' ? item.status : listing.status ?? item.status,
        }
        : item));
    setRemoteListings((current) => listing?.status === 'active'
      ? current.map((item) => item.id === listingId ? listing : item)
      : current.filter((item) => item.id !== listingId));
    return listing;
  }, []);

  const listings = useMemo(() => remoteListings.filter(item => !blockedIds.has(item.seller.id)), [remoteListings, blockedIds]);
  useEffect(() => { void refresh(); }, [blockingRevision, refresh]);
  const value = useMemo<ListingStoreValue>(() => ({
    listings,
    myListings: managedListings.map((item) => item.listing),
    managedListings,
    loading,
    loadingMore,
    myListingsLoading,
    error,
    hasMore,
    browseRadius,
    browseSort,
    locationNotice,
    setBrowseOptions,
    deleteListing,
    getListingById,
    refreshListingById,
    loadMore,
    publishDraft,
    refresh,
    refreshMyListings,
    setListingStatus,
    updateListing,
  }), [
    deleteListing, error, getListingById, hasMore, listings, loadMore, loading,
    loadingMore, managedListings, myListingsLoading, publishDraft, refresh, refreshMyListings,
    refreshListingById, browseRadius, browseSort, locationNotice, setBrowseOptions, setListingStatus,
    updateListing,
  ]);

  return <ListingStoreContext.Provider value={value}>{children}</ListingStoreContext.Provider>;
}

export function useListingStore() {
  const value = useContext(ListingStoreContext);
  if (!value) throw new Error('useListingStore must be used within ListingStoreProvider.');
  return value;
}

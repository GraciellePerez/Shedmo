import { useBlockingStore } from '@/features/blocking/BlockingStore';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren,
} from 'react';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import { telemetry } from '@/services/telemetry';
import { useLocationStore } from '@/features/location/store/LocationStore';
import { searchListings } from '@/features/listings/services/listingRepository';
import {
  initialListingSearchFilters,
  type ListingSearchCursor, type ListingSearchFilters,
} from '@/features/browse/types/search';
import type { Listing } from '@/models';
import { sortListings } from '@/features/browse/listingSort';

interface BrowseStoreValue {
  error: string | null;
  filters: ListingSearchFilters;
  hasMore: boolean;
  initialLoading: boolean;
  items: Listing[];
  loadingMore: boolean;
  queryInput: string;
  refreshing: boolean;
  filterError: string | null;
  applyFilters: (filters: ListingSearchFilters) => boolean;
  clearFilters: () => void;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
  setQueryInput: (value: string) => void;
}

const BrowseStoreContext = createContext<BrowseStoreValue | null>(null);

export function BrowseStoreProvider({ children }: PropsWithChildren) {
  const { session } = useAuthStore();
  const { blockedIds, revision: blockingRevision } = useBlockingStore();
  const { location } = useLocationStore();
  const [filters, setFilters] = useState(initialListingSearchFilters);
  const [queryInput, setQueryInput] = useState('');
  const [items, setItems] = useState<Listing[]>([]);
  const [cursor, setCursor] = useState<ListingSearchCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const generation = useRef(0);
  const loadMoreInFlight = useRef(false);

  const coordinates = useMemo(
    () => location?.latitude != null && location.longitude != null
      ? { latitude: location.latitude, longitude: location.longitude } : null,
    [location?.latitude, location?.longitude],
  );
  const sortedItems = useMemo(() => sortListings(items.filter(item => !blockedIds.has(item.seller.id)), filters.sort), [blockedIds, filters.sort, items]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const query = queryInput.trim();
      setFilters((current) => current.query === query ? current : { ...current, query });
    }, 400);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const loadFirst = useCallback(async (background = false) => {
    const request = ++generation.current;
    if (background) setRefreshing(true);
    else setInitialLoading(true);
    setError(null);
    try {
      const page = await searchListings(filters, null, coordinates);
      if (request !== generation.current) return;
      setItems(page.items);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch {
      if (request === generation.current) setError('Listings could not be loaded. Check your connection and retry.');
    } finally {
      if (request === generation.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [coordinates, filters]);

  useEffect(() => { void loadFirst(false); }, [blockingRevision, loadFirst]);

  useEffect(() => {
    setFilters(initialListingSearchFilters);
    setQueryInput('');
    setItems([]);
    setCursor(null);
    setHasMore(true);
  }, [session?.user.id]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadMoreInFlight.current || !cursor) return;
    loadMoreInFlight.current = true;
    setLoadingMore(true);
    const request = generation.current;
    try {
      const page = await searchListings(filters, cursor, coordinates);
      if (request !== generation.current) return;
      setItems((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch {
      if (request === generation.current) {
        setError('More listings could not be loaded. Tap retry.');
      }
    } finally {
      loadMoreInFlight.current = false;
      setLoadingMore(false);
    }
  }, [coordinates, cursor, filters, hasMore]);

  const applyFilters = useCallback((next: ListingSearchFilters) => {
    const min = next.minPrice.trim() === '' ? null : Number(next.minPrice);
    const max = next.maxPrice.trim() === '' ? null : Number(next.maxPrice);
    if ((min != null && (!Number.isFinite(min) || min < 0))
      || (max != null && (!Number.isFinite(max) || max < 0))) {
      setFilterError('Prices must be nonnegative numbers.');
      return false;
    }
    if (min != null && max != null && max < min) {
      setFilterError('Maximum price cannot be below minimum price.');
      return false;
    }
    if ((next.radius != null || next.sort === 'closest') && !coordinates) {
      setFilterError('Set a marketplace location before using nearby results.');
      return false;
    }
    setFilterError(null);
    setFilters({ ...next, query: queryInput.trim() });
    const filterCount=[next.category,next.condition,next.minPrice,next.maxPrice,next.radius,next.fulfillment!=='all'?next.fulfillment:null,next.sort!=='relevance'?next.sort:null].filter(Boolean).length;
    telemetry.track(queryInput.trim() ? 'search_performed' : 'filter_applied', undefined, undefined, { filter_count: filterCount });
    return true;
  }, [coordinates, queryInput]);

  const clearFilters = useCallback(() => {
    setQueryInput('');
    setFilterError(null);
    setFilters(initialListingSearchFilters);
  }, []);

  const value = useMemo<BrowseStoreValue>(() => ({
    error, filters, hasMore, initialLoading, items: sortedItems, loadingMore, queryInput, refreshing, filterError,
    applyFilters, clearFilters, loadMore,
    refresh: () => loadFirst(true),
    retry: () => loadFirst(false),
    setQueryInput,
  }), [
    applyFilters, clearFilters, error, filterError, filters, hasMore, initialLoading,
    loadFirst, loadMore, loadingMore, queryInput, refreshing,
    sortedItems,
  ]);
  return <BrowseStoreContext.Provider value={value}>{children}</BrowseStoreContext.Provider>;
}

export function useBrowseStore() {
  const value = useContext(BrowseStoreContext);
  if (!value) throw new Error('useBrowseStore must be used within BrowseStoreProvider.');
  return value;
}

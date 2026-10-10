import { useBlockingStore } from '@/features/blocking/BlockingStore';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import {
  addFavorite, fetchFavoriteListing, fetchFavoriteListingIds, fetchFavoriteListings, removeFavorite,
} from '@/features/favorites/services/favoritesRepository';
import type { FavoriteListing } from '@/features/favorites/types/favorite';

interface ToggleResult {
  error?: string;
  saved?: boolean;
}

interface FavoritesStoreValue {
  error: string | null;
  favoriteListings: FavoriteListing[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  savedIds: Set<string>;
  isPending: (listingId: string) => boolean;
  isSaved: (listingId: string) => boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  toggleSaved: (listingId: string) => Promise<ToggleResult>;
}

const FavoritesStoreContext = createContext<FavoritesStoreValue | null>(null);

export function FavoritesStoreProvider({ children }: PropsWithChildren) {
  const { initializing, session } = useAuthStore();
  const { blockedIds, revision: blockingRevision } = useBlockingStore();
  const userId = session?.user.id ?? null;
  const [storedUserId, setStoredUserId] = useState<string | null>(null);
  const [storedIds, setStoredIds] = useState<Set<string>>(new Set());
  const [favoriteListings, setFavoriteListings] = useState<FavoriteListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const pageRef = useRef(0);
  const generationRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const loadRequestRef = useRef(0);

  const load = useCallback(async (targetUserId: string, refreshMode = false) => {
    const generation = generationRef.current;
    const request = ++loadRequestRef.current;
    if (refreshMode) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [ids, page] = await Promise.all([
        fetchFavoriteListingIds(targetUserId),
        fetchFavoriteListings(targetUserId, 0),
      ]);
      if (
        generation !== generationRef.current
        || request !== loadRequestRef.current
        || targetUserId !== userId
      ) return;
      setStoredUserId(targetUserId);
      setStoredIds(new Set(ids));
      setFavoriteListings(page.items);
      setHasMore(page.hasMore);
      pageRef.current = page.nextPage;
    } catch {
      if (generation === generationRef.current && request === loadRequestRef.current) {
        setError('Saved items could not be loaded. Check your connection and try again.');
      }
    } finally {
      if (generation === generationRef.current && request === loadRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    generationRef.current += 1;
    loadRequestRef.current += 1;
    loadMoreInFlightRef.current = false;
    pendingRef.current.clear();
    setPendingIds(new Set());
    setStoredIds(new Set());
    setFavoriteListings([]);
    setStoredUserId(null);
    setHasMore(false);
    setError(null);
    pageRef.current = 0;
    if (!initializing && userId) void load(userId);
    else setLoading(false);
  }, [initializing, load, userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    await load(userId, true);
  }, [load, userId]);

  useEffect(() => { void refresh(); }, [blockingRevision, refresh]);

  const loadMore = useCallback(async () => {
    if (!userId || storedUserId !== userId || loadMoreInFlightRef.current || !hasMore) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    setError(null);
    const generation = generationRef.current;
    try {
      const page = await fetchFavoriteListings(userId, pageRef.current);
      if (generation !== generationRef.current) return;
      setFavoriteListings((current) => [
        ...current,
        ...page.items.filter((item) =>
          !current.some((existing) => existing.listing.id === item.listing.id)),
      ]);
      setHasMore(page.hasMore);
      pageRef.current = page.nextPage;
    } catch {
      if (generation === generationRef.current) {
        setError('More saved items could not be loaded. Try again.');
      }
    } finally {
      loadMoreInFlightRef.current = false;
      if (generation === generationRef.current) setLoadingMore(false);
    }
  }, [hasMore, storedUserId, userId]);

  const toggleSaved = useCallback(async (listingId: string): Promise<ToggleResult> => {
    if (!userId) return { error: 'Sign in to save marketplace listings.' };
    if (pendingRef.current.has(listingId)) return {};

    const wasSaved = storedUserId === userId && storedIds.has(listingId);
    pendingRef.current.add(listingId);
    setPendingIds(new Set(pendingRef.current));
    setStoredUserId(userId);
    setStoredIds((current) => {
      const next = new Set(current);
      if (wasSaved) next.delete(listingId);
      else next.add(listingId);
      return next;
    });
    if (wasSaved) {
      setFavoriteListings((current) =>
        current.filter((item) => item.listing.id !== listingId));
    }

    try {
      if (wasSaved) await removeFavorite(userId, listingId);
      else {
        await addFavorite(userId, listingId);
        try {
          const favorite = await fetchFavoriteListing(userId, listingId);
          if (favorite) {
            setFavoriteListings((current) => [
              favorite,
              ...current.filter((item) => item.listing.id !== listingId),
            ]);
          }
        } catch {
          setError('The item was saved, but its details could not be refreshed yet.');
          void load(userId, true);
        }
      }
      return { saved: !wasSaved };
    } catch {
      setStoredIds((current) => {
        const next = new Set(current);
        if (wasSaved) next.add(listingId);
        else next.delete(listingId);
        return next;
      });
      setError(
        wasSaved
          ? 'This item could not be removed from Saved Items. Try again.'
          : 'This listing may no longer be available. Refresh and try again.',
      );
      if (wasSaved) void load(userId, true);
      return { error: 'Your saved-item change could not be completed. Please try again.' };
    } finally {
      pendingRef.current.delete(listingId);
      setPendingIds(new Set(pendingRef.current));
    }
  }, [load, storedIds, storedUserId, userId]);

  const visibleIds = useMemo(
    () => storedUserId === userId ? storedIds : new Set<string>(),
    [storedIds, storedUserId, userId],
  );
  const value = useMemo<FavoritesStoreValue>(() => ({
    error,
    favoriteListings: storedUserId === userId ? favoriteListings.filter(item => !blockedIds.has(item.listing.seller.id)) : [],
    hasMore: storedUserId === userId && hasMore,
    loading,
    loadingMore,
    refreshing,
    savedIds: visibleIds,
    isPending: (listingId) => pendingIds.has(listingId),
    isSaved: (listingId) => visibleIds.has(listingId),
    loadMore,
    refresh,
    toggleSaved,
  }), [
    blockedIds, error, favoriteListings, hasMore, loadMore, loading, loadingMore, pendingIds,
    refresh, refreshing, storedUserId, toggleSaved, userId, visibleIds,
  ]);

  return <FavoritesStoreContext.Provider value={value}>{children}</FavoritesStoreContext.Provider>;
}

export function useFavoritesStore() {
  const value = useContext(FavoritesStoreContext);
  if (!value) throw new Error('useFavoritesStore must be used within FavoritesStoreProvider.');
  return value;
}

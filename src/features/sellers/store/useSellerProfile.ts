import { useBlockingStore } from '@/features/blocking/BlockingStore';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchPublicSellerListings, fetchPublicSellerProfile,
} from '@/features/sellers/services/sellerRepository';
import type { PublicSellerProfile } from '@/features/sellers/types/sellerProfile';
import type { Listing } from '@/models';

export function useSellerProfile(sellerId: string) {
  const { blockedIds, revision: blockingRevision } = useBlockingStore();
  const [profile, setProfile] = useState<PublicSellerProfile | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(0);
  const generationRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);

  const load = useCallback(async (refresh = false) => {
    const generation = ++generationRef.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [nextProfile, page] = await Promise.all([
        fetchPublicSellerProfile(sellerId),
        fetchPublicSellerListings(sellerId, 0),
      ]);
      if (generation !== generationRef.current) return;
      setProfile(nextProfile);
      setListings(page.items);
      setHasMore(page.hasMore);
      pageRef.current = page.nextPage;
    } catch {
      if (generation === generationRef.current) {
        setError('This seller could not be loaded. Check your connection and retry.');
      }
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [sellerId]);

  useEffect(() => {
    setProfile(null);
    setListings([]);
    pageRef.current = 0;
    void load();
    return () => {
      generationRef.current += 1;
      loadMoreInFlightRef.current = false;
    };
  }, [blockingRevision, load]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    const generation = generationRef.current;
    try {
      const page = await fetchPublicSellerListings(sellerId, pageRef.current);
      if (generation !== generationRef.current) return;
      setListings((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setHasMore(page.hasMore);
      pageRef.current = page.nextPage;
    } catch {
      if (generation === generationRef.current) {
        setError('More seller listings could not be loaded. Try again.');
      }
    } finally {
      loadMoreInFlightRef.current = false;
      if (generation === generationRef.current) setLoadingMore(false);
    }
  }, [hasMore, sellerId]);

  return {
    error, hasMore, listings: listings.filter(item => !blockedIds.has(item.seller.id)), loading, loadingMore, profile, refreshing,
    loadMore,
    refresh: () => load(true),
    retry: () => load(false),
  };
}

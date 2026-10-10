import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren,
} from 'react';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import {
  getPermissionState, requestCurrentMarketplaceLocation, resolveManualMarketplaceLocation,
  resolvePostalMarketplaceLocation,
} from '@/features/location/services/locationService';
import type {
  LocationPermissionState, ManualLocationInput, MarketplaceLocation,
} from '@/features/location/types/location';

interface LocationStoreValue {
  error: string | null;
  loading: boolean;
  location: MarketplaceLocation | null;
  permission: LocationPermissionState;
  clearError: () => void;
  useCurrentLocation: () => Promise<MarketplaceLocation | null>;
  useManualLocation: (input: ManualLocationInput) => Promise<MarketplaceLocation | null>;
  useProfileLocation: () => Promise<MarketplaceLocation | null>;
  usePostalLocation: (postalCode: string) => Promise<MarketplaceLocation | null>;
}

const LocationStoreContext = createContext<LocationStoreValue | null>(null);

export function LocationStoreProvider({ children }: PropsWithChildren) {
  const { profile, session } = useAuthStore();
  const userId = session?.user.id;
  const [location, setLocation] = useState<MarketplaceLocation | null>(null);
  const [permission, setPermission] = useState<LocationPermissionState>('unknown');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedThisSession = useRef(false);

  useEffect(() => {
    setLocation(null);
    setError(null);
    setPermission('unknown');
    requestedThisSession.current = false;
    if (userId) void getPermissionState().then(setPermission).catch(() => undefined);
  }, [userId]);

  const run = useCallback(async (operation: () => Promise<MarketplaceLocation>) => {
    setLoading(true);
    setError(null);
    try {
      const next = await operation();
      setLocation(next);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Location is temporarily unavailable.');
      return null;
    } finally {
      setLoading(false);
      void getPermissionState().then(setPermission).catch(() => undefined);
    }
  }, []);

  const useCurrentLocation = useCallback(() => {
    if (requestedThisSession.current && (permission === 'denied' || permission === 'restricted')) {
      setError('Location permission is unavailable. Use your profile or enter a city and state.');
      return Promise.resolve(null);
    }
    requestedThisSession.current = true;
    return run(requestCurrentMarketplaceLocation);
  }, [permission, run]);
  const useManualLocation = useCallback(
    (input: ManualLocationInput) => run(() => resolveManualMarketplaceLocation(input)),
    [run],
  );
  const useProfileLocation = useCallback(() => run(() => resolveManualMarketplaceLocation({
    city: profile?.city || '',
    state: profile?.state || '',
    postalCode: profile?.postal_code || '',
  }, 'profile')), [profile, run]);
  const usePostalLocation = useCallback(
    (postalCode: string) => run(() => resolvePostalMarketplaceLocation(postalCode)),
    [run],
  );

  const value = useMemo<LocationStoreValue>(() => ({
    error, loading, location, permission,
    clearError: () => setError(null),
    useCurrentLocation, useManualLocation, useProfileLocation, usePostalLocation,
  }), [
    error, loading, location, permission, useCurrentLocation, useManualLocation,
    useProfileLocation, usePostalLocation,
  ]);
  return <LocationStoreContext.Provider value={value}>{children}</LocationStoreContext.Provider>;
}

export function useLocationStore() {
  const value = useContext(LocationStoreContext);
  if (!value) throw new Error('useLocationStore must be used within LocationStoreProvider.');
  return value;
}

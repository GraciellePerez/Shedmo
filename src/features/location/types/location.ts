export type LocationSource = 'device' | 'manual' | 'profile';
export type LocationPermissionState = 'unknown' | 'undetermined' | 'granted' | 'denied' | 'restricted';

export interface MarketplaceLocation {
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  source: LocationSource;
}

export interface ManualLocationInput {
  city: string;
  state: string;
  postalCode?: string;
}

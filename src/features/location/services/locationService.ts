import * as ExpoLocation from 'expo-location';

import type {
  LocationPermissionState, ManualLocationInput, MarketplaceLocation,
} from '@/features/location/types/location';
import {
  normalizeCity, normalizePostalCode, normalizeState, stateCodeForRegion,
  validateManualLocation,
} from '@/features/location/locationValidation';

const approximate = (value: number) => Math.round(value * 1000) / 1000;

export async function getPermissionState(): Promise<LocationPermissionState> {
  const permission = await ExpoLocation.getForegroundPermissionsAsync();
  if (permission.granted) return 'granted';
  if (permission.status === ExpoLocation.PermissionStatus.UNDETERMINED) return 'undetermined';
  return permission.canAskAgain ? 'denied' : 'restricted';
}

export async function requestCurrentMarketplaceLocation(): Promise<MarketplaceLocation> {
  if (!(await ExpoLocation.hasServicesEnabledAsync())) {
    throw new Error('Location Services are off. Turn them on or enter a city and state.');
  }
  let permission = await ExpoLocation.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await ExpoLocation.requestForegroundPermissionsAsync();
  }
  if (!permission.granted) {
    throw new Error('Location permission was not granted. You can enter a location manually.');
  }
  const position = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
  const latitude = approximate(position.coords.latitude);
  const longitude = approximate(position.coords.longitude);
  const [place] = await ExpoLocation.reverseGeocodeAsync({ latitude, longitude });
  return {
    city: place?.city || place?.district || place?.subregion || '',
    state: (place?.region || '').toUpperCase(),
    postalCode: place?.postalCode || '',
    latitude,
    longitude,
    source: 'device',
  };
}

export async function resolveManualMarketplaceLocation(
  input: ManualLocationInput,
  source: 'manual' | 'profile' = 'manual',
): Promise<MarketplaceLocation> {
  const city = normalizeCity(input.city);
  const state = normalizeState(input.state);
  const postalCode = normalizePostalCode(input.postalCode || '');
  const validationError = validateManualLocation(city, state, postalCode);
  if (validationError) throw new Error(validationError);
  try {
    const [point] = await ExpoLocation.geocodeAsync(`${city}, ${state} ${postalCode}`.trim());
    if (!point) throw new Error('That city and state could not be verified.');
    const [verified] = await ExpoLocation.reverseGeocodeAsync(point);
    const verifiedState = stateCodeForRegion(verified?.region);
    if (verifiedState && verifiedState !== state) {
      throw new Error('The selected state does not match the geocoded city.');
    }
    return {
      city: normalizeCity(verified?.city || city),
      state: verifiedState || state,
      postalCode: verified?.postalCode || postalCode,
      latitude: approximate(point.latitude),
      longitude: approximate(point.longitude),
      source,
    };
  } catch (cause) {
    if (cause instanceof Error && (
      cause.message.includes('could not be verified') || cause.message.includes('does not match')
    )) throw cause;
    throw new Error('That location could not be verified. Check the city, state, and ZIP code.');
  }
}

export async function resolvePostalMarketplaceLocation(postalInput: string): Promise<MarketplaceLocation> {
  const postalCode = normalizePostalCode(postalInput);
  if (!postalCode || !/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    throw new Error('Use a 5-digit ZIP code or ZIP+4.');
  }
  try {
    const [point] = await ExpoLocation.geocodeAsync(postalCode);
    if (!point) throw new Error('ZIP not found');
    const [place] = await ExpoLocation.reverseGeocodeAsync(point);
    const city = normalizeCity(place?.city || place?.district || place?.subregion || '');
    const state = stateCodeForRegion(place?.region);
    if (!city || !state) throw new Error('ZIP locality unavailable');
    return {
      city,
      state,
      postalCode: place?.postalCode || postalCode,
      latitude: approximate(point.latitude),
      longitude: approximate(point.longitude),
      source: 'manual',
    };
  } catch {
    throw new Error('That ZIP code could not be verified. Check it and try again.');
  }
}

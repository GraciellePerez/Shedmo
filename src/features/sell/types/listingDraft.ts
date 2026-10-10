import type { ListingCondition } from '@/models';
import type { LocationSource } from '@/features/location/types/location';
import {
  LISTING_CATEGORIES,
  type ListingCategoryLabel,
} from '@/features/listings/categoryLabels';

export const sellCategories: readonly ListingCategoryLabel[] = LISTING_CATEGORIES.map(
  ({ label }) => label,
);

export const sellConditions: ListingCondition[] = [
  'New',
  'Like New',
  'Good',
  'Fair',
  'For Parts',
];

export type SellCategory = ListingCategoryLabel;
export type SellStep = 1 | 2 | 3 | 4;

export const LISTING_DESCRIPTION_MIN_LENGTH = 10;
export const LISTING_DESCRIPTION_MAX_LENGTH = 5000;
export const LISTING_TITLE_MIN_LENGTH = 3;
export const LISTING_TITLE_MAX_LENGTH = 120;

export function normalizeListingTitle(value: string) {
  return value.trim();
}

export function listingTitleLength(value: string) {
  return [...normalizeListingTitle(value)].length;
}

export function normalizeListingDescription(value: string) {
  return value.trim();
}

export function listingDescriptionLength(value: string) {
  return [...normalizeListingDescription(value)].length;
}

export interface ListingDraftPhoto {
  id: string;
  uri: string;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string | null;
  width?: number;
  height?: number;
}

export interface ListingDraft {
  photos: ListingDraftPhoto[];
  title: string;
  category: SellCategory | '';
  brand: string;
  condition: ListingCondition | '';
  description: string;
  modelNumber: string;
  year: string;
  price: string;
  pickup: boolean;
  shipping: boolean;
  shippingPrice: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  locationSource: LocationSource | null;
}

export type ListingDraftErrors = Partial<Record<keyof ListingDraft | 'delivery', string>>;

export const initialListingDraft: ListingDraft = {
  photos: [],
  title: '',
  category: '',
  brand: '',
  condition: '',
  description: '',
  modelNumber: '',
  year: '',
  price: '',
  pickup: true,
  shipping: true,
  shippingPrice: '',
  city: '',
  state: '',
  postalCode: '',
  latitude: null,
  longitude: null,
  locationSource: null,
};

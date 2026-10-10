import type { DatabaseListingCategory } from '@/features/listings/types/listing';

export const LISTING_CATEGORIES = [
  { label: 'Tools', value: 'tools' },
  { label: 'Auto Parts', value: 'auto_parts' },
  { label: 'Tool Storage', value: 'tool_storage' },
  { label: 'Equipment', value: 'equipment' },
  { label: 'Marine', value: 'marine' },
  { label: 'Outdoor Power', value: 'outdoor_power' },
  { label: 'Shop Equipment', value: 'shop_equipment' },
  { label: 'Supplies', value: 'supplies' },
] as const satisfies readonly { label: string; value: DatabaseListingCategory }[];

export type ListingCategoryLabel = (typeof LISTING_CATEGORIES)[number]['label'];

export const LISTING_CATEGORY_LABELS = Object.fromEntries(
  LISTING_CATEGORIES.map(({ label, value }) => [value, label]),
) as Record<DatabaseListingCategory, ListingCategoryLabel>;

export const LISTING_CATEGORY_OPTIONS = LISTING_CATEGORIES.map(
  ({ label, value }) => [value, label] as const,
);

export const LISTING_CATEGORY_BY_LABEL = Object.fromEntries(
  LISTING_CATEGORIES.map(({ label, value }) => [label, value]),
) as Record<ListingCategoryLabel, DatabaseListingCategory>;

export function formatListingCategory(value: string) {
  return LISTING_CATEGORY_LABELS[value as DatabaseListingCategory]
    ?? value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

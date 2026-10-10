import { LISTING_CATEGORY_OPTIONS } from '@/features/listings/categoryLabels';

export interface Category {
  id: string;
  label: string;
}

export const categories: Category[] = [
  { id: 'all', label: 'All' },
  ...LISTING_CATEGORY_OPTIONS.map(([id, label]) => ({ id, label })),
];

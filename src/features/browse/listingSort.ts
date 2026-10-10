import type { ListingSortOption } from '@/features/browse/types/search';
import type { Listing } from '@/models';

export function sortListings(listings: Listing[], sort: ListingSortOption) {
  // The RPC ranks across the entire result set and pages by score/date/id.
  if (sort === 'relevance') return [...listings];
  return [...listings].sort((left, right) => {
    if (sort === 'closest') {
      const distanceOrder = compareNullableNumbers(left.distanceMiles, right.distanceMiles);
      if (distanceOrder !== 0) return distanceOrder;
    } else if (sort === 'price_asc' || sort === 'price_desc') {
      const priceOrder = Number(left.price) - Number(right.price);
      if (priceOrder !== 0) return sort === 'price_asc' ? priceOrder : -priceOrder;
    }

    const createdOrder = timestamp(right.createdAt) - timestamp(left.createdAt);
    return createdOrder || right.id.localeCompare(left.id);
  });
}

function compareNullableNumbers(left: number | null | undefined, right: number | null | undefined) {
  const usableLeft = left != null && Number.isFinite(left) && left >= 0 ? left : null;
  const usableRight = right != null && Number.isFinite(right) && right >= 0 ? right : null;
  if (usableLeft == null) return usableRight == null ? 0 : 1;
  if (usableRight == null) return -1;
  return usableLeft - usableRight;
}

function timestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

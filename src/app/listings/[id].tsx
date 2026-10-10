import { useLocalSearchParams } from 'expo-router';

import { ProductDetailsScreen } from '@/features/listings/ProductDetailsScreen';

export default function ListingDetailsRoute() {
  const { id, distanceMiles } = useLocalSearchParams<{ id: string; distanceMiles?: string }>();

  const parsedDistance = distanceMiles == null ? null : Number(distanceMiles);
  return (
    <ProductDetailsScreen
      initialDistanceMiles={Number.isFinite(parsedDistance) ? parsedDistance : null}
      listingId={id}
    />
  );
}

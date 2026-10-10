import { useLocalSearchParams } from 'expo-router';
import { EditListingScreen } from '@/features/listings/EditListingScreen';

export default function EditListingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditListingScreen listingId={id} />;
}

import { useLocalSearchParams } from 'expo-router';
import { CheckoutScreen } from '@/features/checkout/CheckoutScreen';

export default function CheckoutRoute() {
  const { fulfillment, listingId } = useLocalSearchParams<{ fulfillment?: string; listingId: string }>();
  return <CheckoutScreen listingId={listingId} requestedFulfillment={fulfillment === 'shipping' ? 'shipping' : undefined} />;
}

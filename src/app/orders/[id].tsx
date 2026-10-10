import { useLocalSearchParams } from 'expo-router';
import { FulfillmentOrderScreen } from '@/features/fulfillment/FulfillmentOrderScreen';
export default function OrderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FulfillmentOrderScreen orderId={id} />;
}

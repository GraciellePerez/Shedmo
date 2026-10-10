import { useLocalSearchParams } from 'expo-router';
import { OrderConfirmationScreen } from '@/features/checkout/OrderConfirmationScreen';
export default function OrderConfirmationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrderConfirmationScreen orderId={id} />;
}

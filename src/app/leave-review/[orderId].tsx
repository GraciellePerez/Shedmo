import { useLocalSearchParams } from 'expo-router';
import { LeaveReviewScreen } from '@/features/account/LeaveReviewScreen';
export default function LeaveReviewRoute() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  return <LeaveReviewScreen orderId={orderId} />;
}

import { useLocalSearchParams } from 'expo-router';
import { ReviewsScreen } from '@/features/account/ReviewsScreen';
export default function ReviewsRoute() {
  const { sellerId } = useLocalSearchParams<{ sellerId: string }>();
  return <ReviewsScreen sellerId={sellerId} />;
}

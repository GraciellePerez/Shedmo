import { useLocalSearchParams } from 'expo-router';

import { SellerProfileScreen } from '@/features/sellers/SellerProfileScreen';

export default function SellerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SellerProfileScreen sellerId={id} />;
}

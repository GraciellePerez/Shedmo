import { useLocalSearchParams } from 'expo-router';
import { SettingDetailScreen } from '@/features/account/SettingDetailScreen';
export default function SettingRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <SettingDetailScreen slug={slug} />;
}

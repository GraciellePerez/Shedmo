import { Link } from 'expo-router';
import { Text } from 'react-native';

import { colors } from '@/theme';

export function ListingPhotoSafetyNotice() {
  return (
    <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>
      Use photos you have permission to share. Do not include private information or prohibited content.{' '}
      <Link href="/settings/prohibited-items" style={{ textDecorationLine: 'underline' }}>Marketplace Rules</Link>
    </Text>
  );
}

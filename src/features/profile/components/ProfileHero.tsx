import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function ProfileHero({
  initials,
  photoUri,
  name,
  verified,
  subtitle,
  rating,
  reviews,
  onReviewsPress,
}: {
  initials: string;
  photoUri?: string;
  name: string;
  verified: boolean;
  subtitle: string;
  rating: number | null;
  reviews: number;
  onReviewsPress?: () => void;
}) {
  return (
    <View style={styles.row}>
      <Avatar imageUri={photoUri} initials={initials} size={74} />
      <View style={styles.copy}>
        <View style={styles.nameRow}>
          <Text numberOfLines={1} style={styles.name}>{name}</Text>
          {verified ? <Ionicons color={colors.info} name="checkmark-circle" size={18} /> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`View ${reviews} reviews`} disabled={!onReviewsPress} onPress={onReviewsPress} hitSlop={8} style={styles.ratingRow}>
          <Ionicons color={colors.warning} name="star" size={14} />
          <Text style={styles.rating}>{rating == null ? 'New seller' : rating.toFixed(1)}</Text>
          <Text style={styles.meta}>· {reviews} reviews</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
  copy: { flex: 1, marginLeft: spacing.lg, minWidth: 0 },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  name: { color: colors.text, flexShrink: 1, fontFamily: fontFamily.extraBold, fontSize: fontSize.title },
  ratingRow: { alignItems: 'center', flexDirection: 'row', marginTop: 5 },
  rating: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.bodySmall, marginLeft: spacing.xs },
  meta: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, marginLeft: spacing.xs },
  subtitle: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginTop: 5 },
});

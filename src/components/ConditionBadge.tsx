import { StyleSheet, Text, View } from 'react-native';

import type { ListingCondition } from '@/models';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

const badgeColors: Record<ListingCondition, { background: string; text: string }> = {
  New: { background: '#E8F8EE', text: '#248A3D' },
  'Like New': { background: '#E8F2FF', text: '#1769AA' },
  Good: { background: '#FFF4D9', text: '#9A6700' },
  Fair: { background: colors.background, text: colors.textSecondary },
  'For Parts': { background: '#FCE8E6', text: '#B3261E' },
};

export function ConditionBadge({ condition }: { condition: ListingCondition }) {
  const palette = badgeColors[condition];

  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]}>
      <Text style={[styles.label, { color: palette.text }]}>{condition}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.round,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.caption,
  },
});

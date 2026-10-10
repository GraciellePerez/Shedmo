import { StyleSheet, Text, View } from 'react-native';

import type { SellStep } from '@/features/sell/types/listingDraft';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

const labels = ['Photos', 'Details', 'Pricing', 'Preview'];

export function SellProgress({ step }: { step: SellStep }) {
  return (
    <View style={styles.container}>
      <View style={styles.bars}>
        {labels.map((label, index) => (
          <View
            accessibilityLabel={`${label} step ${index + 1}`}
            key={label}
            style={[styles.bar, index + 1 <= step && styles.activeBar]}
          />
        ))}
      </View>
      <View style={styles.labels}>
        {labels.map((label, index) => (
          <Text key={label} style={[styles.label, index + 1 === step && styles.activeLabel]}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  bars: { flexDirection: 'row', gap: spacing.xs },
  bar: { backgroundColor: colors.border, borderRadius: 2, flex: 1, height: 4 },
  activeBar: { backgroundColor: colors.primary },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  label: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption },
  activeLabel: { color: colors.primary, fontFamily: fontFamily.bold },
});

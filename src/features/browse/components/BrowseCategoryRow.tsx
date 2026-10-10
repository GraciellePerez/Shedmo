import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface BrowseCategoryRowProps {
  count: number;
  icon: IconName;
  label: string;
  onPress: () => void;
  showDivider?: boolean;
}

export function BrowseCategoryRow({
  count,
  icon,
  label,
  onPress,
  showDivider = true,
}: BrowseCategoryRowProps) {
  return (
    <Pressable
      accessibilityHint={`Shows ${label} listings`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, showDivider && styles.divider, pressed && styles.pressed]}
    >
      <View style={styles.leading}>
        <View style={styles.iconBox}>
          <Ionicons color={colors.text} name={icon} size={21} />
        </View>
        <View>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.count}>{count.toLocaleString()} listings</Text>
        </View>
      </View>
      <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 65,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  divider: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leading: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.md,
    height: 40,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 40,
  },
  label: {
    color: colors.text,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.body,
  },
  count: {
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.footnote,
    marginTop: spacing.xxs,
  },
  pressed: {
    backgroundColor: colors.background,
  },
});

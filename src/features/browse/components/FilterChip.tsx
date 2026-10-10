import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

interface FilterChipProps {
  active: boolean;
  label: string;
  onPress: () => void;
}

export function FilterChip({ active, label, onPress }: FilterChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.activeChip,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.round,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 14,
    paddingVertical: spacing.xs,
  },
  activeChip: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  label: {
    color: colors.text,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.footnote,
  },
  activeLabel: {
    color: colors.white,
  },
  pressed: {
    opacity: 0.72,
  },
});

import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function ProfileMenuRow({
  icon,
  label,
  subtitle,
  onPress,
  last = false,
}: {
  icon: IconName;
  label: string;
  subtitle?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}>
      <View style={styles.icon}>
        <Ionicons color={colors.text} name={icon} size={19} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', minHeight: 60, paddingHorizontal: spacing.lg },
  divider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  pressed: { backgroundColor: colors.background },
  icon: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.sm, height: 36, justifyContent: 'center', width: 36 },
  copy: { flex: 1, marginLeft: spacing.md },
  label: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.body },
  subtitle: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginTop: 2 },
});

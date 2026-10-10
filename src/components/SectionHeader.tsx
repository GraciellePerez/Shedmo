import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, spacing } from '@/theme';

interface SectionHeaderProps {
  title: string;
  onSeeAll?: () => void;
}

export function SectionHeader({ title, onSeeAll }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {onSeeAll ? (
        <Pressable accessibilityRole="button" onPress={onSeeAll} hitSlop={8}>
          <Text style={styles.action}>See all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontFamily: fontFamily.bold,
    fontSize: fontSize.subtitle,
  },
  action: {
    color: colors.primary,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.bodySmall,
  },
});

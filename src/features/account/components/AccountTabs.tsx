import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function AccountTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.row} horizontal showsHorizontalScrollIndicator={false}>
      {items.map((item) => (
        <Pressable key={item.value} onPress={() => onChange(item.value)} style={[styles.tab, value === item.value && styles.active]}>
          <Text style={[styles.label, value === item.value && styles.activeLabel]}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.surface, minWidth: '100%', paddingHorizontal: spacing.md },
  tab: { alignItems: 'center', borderBottomColor: 'transparent', borderBottomWidth: 2, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.md },
  active: { borderBottomColor: colors.primary },
  label: { color: colors.textSecondary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  activeLabel: { color: colors.primary },
});

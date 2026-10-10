import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ConversationFilter } from '@/features/messaging/types/messaging';
import { colors, fontFamily, fontSize, radii, shadows } from '@/theme';

const filters: ConversationFilter[] = ['all', 'buying', 'selling'];

export function InboxFilter({
  value,
  onChange,
}: {
  value: ConversationFilter;
  onChange: (value: ConversationFilter) => void;
}) {
  return (
    <View style={styles.track}>
      {filters.map((filter) => {
        const active = filter === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={filter}
            onPress={() => onChange(filter)}
            style={[styles.tab, active && styles.activeTab]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: 'row',
    padding: 3,
  },
  tab: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
  },
  activeTab: {
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  label: {
    color: colors.textSecondary,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.bodySmall,
  },
  activeLabel: {
    color: colors.text,
  },
});

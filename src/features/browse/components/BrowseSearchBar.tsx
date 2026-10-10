import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

interface BrowseSearchBarProps {
  value: string;
  onChangeText: (value: string) => void;
  onFilterPress: () => void;
  onSubmit?: () => void;
}

export function BrowseSearchBar({
  value,
  onChangeText,
  onFilterPress,
  onSubmit,
}: BrowseSearchBarProps) {
  return (
    <View style={styles.row}>
      <View style={styles.search}>
        <Ionicons color={colors.textSecondary} name="search" size={18} />
        <TextInput
          accessibilityLabel="Search marketplace listings"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="never"
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          placeholder="Search..."
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
          style={styles.input}
          value={value}
        />
        {value ? (
          <Pressable
            accessibilityLabel="Clear search"
            hitSlop={8}
            onPress={() => onChangeText('')}
            style={styles.clear}
          >
            <Ionicons color={colors.textSecondary} name="close-circle" size={18} />
          </Pressable>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel="Show listing filters"
        accessibilityRole="button"
        onPress={onFilterPress}
        style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.white} name="options-outline" size={21} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  search: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    height: 44,
    marginLeft: spacing.sm,
    padding: 0,
  },
  clear: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    marginRight: -spacing.sm,
    width: 32,
  },
  filterButton: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: radii.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: {
    opacity: 0.78,
  },
});

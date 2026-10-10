import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

interface ChoiceGridProps<T extends string> {
  error?: string;
  label: string;
  onChange: (value: T) => void;
  options: readonly T[];
  value: T | '';
}

export function ChoiceGrid<T extends string>({
  error,
  label,
  onChange,
  options,
  value,
}: ChoiceGridProps<T>) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.grid}>
        {options.map((option) => {
          const active = option === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={option}
              onPress={() => onChange(option)}
              style={[styles.choice, active && styles.activeChoice]}
            >
              <Text style={[styles.choiceText, active && styles.activeChoiceText]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  label: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.md,
    width: '47.8%',
  },
  activeChoice: { backgroundColor: colors.text },
  choiceText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  activeChoiceText: { color: colors.white },
  error: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, marginTop: spacing.sm },
});

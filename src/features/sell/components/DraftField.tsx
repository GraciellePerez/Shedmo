import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

interface DraftFieldProps extends TextInputProps {
  error?: string;
  label: string;
  optional?: boolean;
}

export function DraftField({ error, label, optional, multiline, style, ...props }: DraftFieldProps) {
  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {optional ? <Text style={styles.optional}>Optional</Text> : null}
      </View>
      <TextInput
        multiline={multiline}
        placeholderTextColor={colors.textSecondary}
        style={[
          styles.input,
          multiline && styles.multiline,
          error && styles.inputError,
          style,
        ]}
        textAlignVertical={multiline ? 'top' : 'center'}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  optional: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption },
  input: {
    backgroundColor: colors.background,
    borderColor: 'transparent',
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
  },
  multiline: { minHeight: 112 },
  inputError: { borderColor: colors.primary },
  error: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, marginTop: 5 },
});

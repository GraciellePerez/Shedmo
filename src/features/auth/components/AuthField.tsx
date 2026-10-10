import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function AuthField({
  error,
  label,
  password = false,
  ...props
}: TextInputProps & { error?: string; label: string; password?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, error && styles.errorBorder]}>
        <TextInput
          autoCorrect={false}
          placeholderTextColor={colors.textSecondary}
          secureTextEntry={password && !visible}
          style={styles.input}
          {...props}
        />
        {password ? (
          <Pressable accessibilityLabel={visible ? 'Hide password' : 'Show password'} hitSlop={8} onPress={() => setVisible((current) => !current)}>
            <Ionicons color={colors.textSecondary} name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: spacing.md },
  label: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall, marginBottom: 6 },
  inputWrap: { alignItems: 'center', backgroundColor: colors.background, borderColor: 'transparent', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', paddingRight: spacing.md },
  errorBorder: { borderColor: colors.primary },
  input: { color: colors.text, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.body, minHeight: 50, paddingHorizontal: spacing.md },
  error: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, marginTop: 5 },
});

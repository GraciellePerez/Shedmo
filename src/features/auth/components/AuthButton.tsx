import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontFamily, fontSize, radii } from '@/theme';

export function AuthButton({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={loading} onPress={onPress} style={({ pressed }) => [styles.button, (pressed || loading) && styles.dimmed]}>
      {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.label}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: 52 },
  dimmed: { opacity: 0.68 },
  label: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
});

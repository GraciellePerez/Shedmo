import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function AccountEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.icon}><Ionicons color={colors.textSecondary} name="file-tray-outline" size={34} /></View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl },
  icon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.round, height: 68, justifyContent: 'center', width: 68 },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.lg },
  body: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' },
});

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontFamily, fontSize, spacing } from '@/theme';

export default function AuthCallbackRoute() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.title}>Verifying your account…</Text>
        <Text style={styles.note}>Preparing your Shedmo account</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  title: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.body, marginTop: spacing.lg },
  note: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: spacing.sm, textAlign: 'center' },
});

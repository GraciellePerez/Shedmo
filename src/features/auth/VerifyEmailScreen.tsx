import { Ionicons } from '@expo/vector-icons';
import { Link, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthShell } from '@/features/auth/components/AuthShell';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function VerifyEmailScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  return (
    <AuthShell subtitle="Supabase requires email confirmation before your first sign-in." title="Check your inbox">
      <View style={styles.icon}><Ionicons color={colors.primary} name="mail-outline" size={34} /></View>
      <Text style={styles.body}>We sent a verification link{email ? ` to ${email}` : ''}. Open it, then return to the app and sign in.</Text>
      <Text style={styles.tip}>If you do not see the email, check spam or wait a minute before trying again.</Text>
      <Text style={styles.footer}><Link href="/sign-in" style={styles.link}>Continue to Sign In</Link></Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#FFF1F0', borderRadius: radii.round, height: 70, justifyContent: 'center', width: 70 },
  body: { color: colors.text, fontFamily: fontFamily.medium, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.lg, textAlign: 'center' },
  tip: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 19, marginTop: spacing.md, textAlign: 'center' },
  footer: { marginTop: spacing.xl, textAlign: 'center' },
  link: { color: colors.primary, fontFamily: fontFamily.bold, fontSize: fontSize.body },
});

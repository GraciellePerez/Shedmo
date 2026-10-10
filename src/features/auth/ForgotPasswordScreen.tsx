import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthField } from '@/features/auth/components/AuthField';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { isEmail } from '@/features/auth/SignInScreen';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function ForgotPasswordScreen() {
  const { configurationError, forgotPassword } = useAuthStore();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(configurationError);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (loading || configurationError) return;
    if (!isEmail(email)) return setMessage('Enter a valid email address.');
    setLoading(true);
    setMessage(null);
    const result = await forgotPassword(email);
    setLoading(false);
    setSuccess(!result.error);
    setMessage(result.error ?? result.success ?? null);
  };
  return (
    <AuthShell subtitle="We’ll send a secure password-reset link to your email." title="Reset password">
      <AuthField autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={setEmail} onSubmitEditing={submit} placeholder="you@example.com" value={email} />
      {message ? <Text style={[styles.message, success && styles.success]}>{message}</Text> : null}
      <AuthButton label="Send Reset Link" loading={loading} onPress={submit} />
      <Text style={styles.footer}><Link href="/sign-in" style={styles.link}>Return to sign in</Link></Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  message: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, lineHeight: 19, marginBottom: spacing.md },
  success: { color: colors.success },
  footer: { marginTop: spacing.lg, textAlign: 'center' },
  link: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
});

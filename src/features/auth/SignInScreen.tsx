import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthField } from '@/features/auth/components/AuthField';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function SignInScreen() {
  const router = useRouter();
  const { configurationError, session, signIn } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(configurationError);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session) return;
    setLoading(false);
    try {
      router.replace('/(tabs)');
    } catch {
      setError('You are signed in, but navigation could not open the marketplace. Please try again.');
    }
  }, [router, session]);

  const submit = async () => {
    if (loading || configurationError) return;
    if (!isEmail(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setLoading(true);
    setError(null);
    try {
      const result = await signIn(email, password);
      if (result.error) setError(result.error);
      else if (!result.authenticated) setError('Sign-in completed without an authenticated session.');
    } catch {
      setError('Unable to complete sign-in. Check your connection and try again.');
    } finally {
      // Navigation is driven by the session effect, so the button cannot remain
      // stuck even if route replacement throws or is rejected by a guard.
      setLoading(false);
    }
  };

  return (
    <AuthShell subtitle="Sign in to manage your profile and marketplace activity." title="Welcome back">
      <AuthField autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" value={email} />
      <AuthField label="Password" onChangeText={setPassword} onSubmitEditing={submit} password placeholder="Your password" returnKeyType="done" value={password} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.forgot}><Link href="/forgot-password" style={styles.link}>Forgot password?</Link></View>
      <AuthButton label="Sign In" loading={loading} onPress={submit} />
      <Text style={styles.footer}>New here? <Link href="/sign-up" style={styles.link}>Create an account</Link></Text>
      <Text onPress={() => router.back()} style={styles.back}>Back</Text>
    </AuthShell>
  );
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const styles = StyleSheet.create({
  error: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, lineHeight: 19, marginBottom: spacing.md },
  forgot: { alignItems: 'flex-end', marginBottom: spacing.lg, marginTop: -spacing.xs },
  link: { color: colors.primary, fontFamily: fontFamily.semibold },
  footer: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, marginTop: spacing.lg, textAlign: 'center' },
  back: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, marginTop: spacing.lg, textAlign: 'center' },
});

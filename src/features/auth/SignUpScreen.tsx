import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthField } from '@/features/auth/components/AuthField';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { isEmail } from '@/features/auth/SignInScreen';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function SignUpScreen() {
  const router = useRouter();
  const { configurationError, signUp } = useAuthStore();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(configurationError);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (loading || configurationError) return;
    if (displayName.trim().length < 2) return setError('Enter your display name.');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username.trim())) return setError('Username must use 3–20 letters, numbers, or underscores.');
    if (!isEmail(email)) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return setError('Include at least one letter and one number.');
    if (password !== confirm) return setError('Passwords do not match.');
    setLoading(true);
    setError(null);
    const result = await signUp(email, password, displayName, username);
    setLoading(false);
    if (result.error) setError(result.error);
    else if (result.needsEmailVerification) router.replace({ pathname: '/verify-email', params: { email: email.trim() } });
  };

  return (
    <AuthShell subtitle="Create your local marketplace profile." title="Create account">
      <AuthField autoCapitalize="words" label="Display name" onChangeText={setDisplayName} placeholder="Jake Reynolds" value={displayName} />
      <AuthField autoCapitalize="none" label="Username" onChangeText={(value) => setUsername(value.replace(/\s/g, ''))} placeholder="jakereynolds" value={username} />
      <AuthField autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" value={email} />
      <AuthField label="Password" onChangeText={setPassword} password placeholder="At least 8 characters" value={password} />
      <AuthField label="Confirm password" onChangeText={setConfirm} onSubmitEditing={submit} password placeholder="Repeat password" value={confirm} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AuthButton label="Create Account" loading={loading} onPress={submit} />
      <Text style={styles.footer}>Already have an account? <Link href="/sign-in" style={styles.link}>Sign in</Link></Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, lineHeight: 19, marginBottom: spacing.md },
  footer: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, marginTop: spacing.lg, textAlign: 'center' },
  link: { color: colors.primary, fontFamily: fontFamily.semibold },
});

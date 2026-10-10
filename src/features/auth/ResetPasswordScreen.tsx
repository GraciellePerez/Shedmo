import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { AuthButton } from '@/features/auth/components/AuthButton';
import { AuthField } from '@/features/auth/components/AuthField';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function ResetPasswordScreen() {
  const router = useRouter();
  const {
    clearPasswordRecovery,
    passwordRecoveryActive,
    session,
    updatePassword,
  } = useAuthStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(session ? null : 'Open this screen from a valid Supabase recovery link to establish a recovery session.');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (loading || !session) return;
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return setMessage('Use at least 8 characters with a letter and a number.');
    if (password !== confirm) return setMessage('Passwords do not match.');
    setLoading(true);
    setMessage(null);
    const result = await updatePassword(password);
    setLoading(false);
    setSuccess(!result.error);
    setMessage(result.error ?? result.success ?? null);
    if (result.error === 'Your new password must be different from your current password.') {
      Alert.alert('Password not changed', result.error);
    }
    if (!result.error) {
      clearPasswordRecovery();
      router.replace('/(tabs)');
    }
  };
  const cancel = () => {
    clearPasswordRecovery();
    router.replace(session ? '/(tabs)' : '/(auth)');
  };
  if (!passwordRecoveryActive) return null;
  return (
    <AuthShell subtitle="Choose a new password for your marketplace account." title="Set new password">
      <AuthField label="New password" onChangeText={setPassword} password placeholder="At least 8 characters" value={password} />
      <AuthField label="Confirm password" onChangeText={setConfirm} onSubmitEditing={submit} password placeholder="Repeat password" value={confirm} />
      {message ? <Text style={[styles.message, success && styles.success]}>{message}</Text> : null}
      <AuthButton label="Update Password" loading={loading} onPress={submit} />
      <Pressable disabled={loading} onPress={cancel} style={styles.cancel}>
        <Text style={styles.cancelText}>Cancel password reset</Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  message: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, lineHeight: 19, marginBottom: spacing.md },
  success: { color: colors.success },
  cancel: { alignItems: 'center', marginTop: spacing.lg, padding: spacing.sm },
  cancelText: { color: colors.textSecondary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
});

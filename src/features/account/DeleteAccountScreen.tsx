import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function DeleteAccountScreen() {
  const router = useRouter();
  const { deleteAccount } = useAuthStore();
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const confirmed = confirmation.trim().toUpperCase() === 'DELETE';

  const remove = async () => {
    if (!confirmed || deleting) return;
    setDeleting(true);
    try {
      const result = await deleteAccount();
      if (result.error) {
        Alert.alert('Account not deleted', result.error);
        return;
      }
      Alert.alert('Account deleted', 'Your Shedmo account and private marketplace data were removed.', [
        { text: 'Done', onPress: () => router.replace('/(auth)') },
      ]);
    } catch {
      Alert.alert('Account not deleted', 'Account deletion could not be completed. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="Delete Account" />
      <View style={styles.content}>
        <Text style={styles.title}>Permanently delete your account</Text>
        <Text style={styles.body}>
          Your sign-in, public profile details, active listings, listing photos, messages, saved items,
          notifications, and device push tokens will be removed or anonymized.
        </Text>
        <Text style={styles.body}>
          Completed transaction, review, safety, and financial records may be retained in anonymized form.
          An unresolved transaction must be completed or canceled first.
        </Text>
        <Text style={styles.label}>Type DELETE to continue</Text>
        <TextInput
          accessibilityLabel="Type DELETE to confirm account deletion"
          autoCapitalize="characters"
          editable={!deleting}
          onChangeText={setConfirmation}
          placeholder="DELETE"
          style={styles.input}
          value={confirmation}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!confirmed || deleting}
          onPress={() => Alert.alert(
            'Delete your account?',
            'This cannot be undone.',
            [
              { style: 'cancel', text: 'Cancel' },
              { style: 'destructive', text: 'Delete Account', onPress: () => void remove() },
            ],
          )}
          style={[styles.button, (!confirmed || deleting) && styles.disabled]}
        >
          {deleting
            ? <ActivityIndicator color={colors.white} />
            : <Text style={styles.buttonText}>Delete Account</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, flex: 1, padding: spacing.xl },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title },
  body: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.md },
  label: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall, marginTop: spacing.xl },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.text, fontFamily: fontFamily.medium, fontSize: fontSize.body, marginTop: spacing.sm, padding: spacing.md },
  button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, justifyContent: 'center', marginTop: spacing.xl, minHeight: 50 },
  buttonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  disabled: { opacity: 0.45 },
});

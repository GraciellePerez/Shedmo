import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createConnectOnboardingLink } from '@/features/payments/services/connectOnboardingService';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function ConnectOnboardingRefreshScreen() {
  const router = useRouter();
  const [error, setError] = useState(false);
  const activeRequest = useRef(false);

  const reopen = useCallback(async () => {
    if (activeRequest.current) return;
    activeRequest.current = true;
    setError(false);
    try {
      const link = await createConnectOnboardingLink();
      await Linking.openURL(link.url);
    } catch {
      setError(true);
    } finally {
      activeRequest.current = false;
    }
  }, []);

  useEffect(() => { void reopen(); }, [reopen]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        {error ? (
          <>
            <Text style={styles.title}>Setup link expired</Text>
            <Text style={styles.body}>Generate a new one-time Stripe onboarding link to continue.</Text>
            <Pressable onPress={() => void reopen()} style={styles.button}>
              <Text style={styles.buttonText}>Generate new link</Text>
            </Pressable>
            <Pressable onPress={() => router.replace('/settings/payouts')} style={styles.secondary}>
              <Text style={styles.secondaryText}>Back to Seller Payouts</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.title}>Generating a new secure link…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle, marginTop: spacing.lg, textAlign: 'center' },
  body: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.sm, textAlign: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: radii.md, marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  buttonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  secondary: { marginTop: spacing.lg, padding: spacing.sm },
  secondaryText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.body },
});

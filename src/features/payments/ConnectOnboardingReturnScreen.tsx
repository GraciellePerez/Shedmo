import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { refreshConnectAccount } from '@/features/payments/services/connectOnboardingService';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function ConnectOnboardingReturnScreen() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void refreshConnectAccount().then(() => {
      if (active) router.replace('/settings/payouts');
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [router]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        {failed ? (
          <>
            <Ionicons color={colors.primary} name="alert-circle-outline" size={48} />
            <Text style={styles.title}>Could not refresh payout status</Text>
            <Text style={styles.body}>Returning from Stripe does not confirm completion. Open Seller Payouts to retry securely.</Text>
            <Pressable onPress={() => router.replace('/settings/payouts')} style={styles.button}>
              <Text style={styles.buttonText}>Open Seller Payouts</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.title}>Checking your Stripe status…</Text>
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
});

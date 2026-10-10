import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createConnectOnboardingLink,
  createOrGetConnectAccount,
  refreshConnectAccount,
} from '@/features/payments/services/connectOnboardingService';
import type { SellerPayoutStatus } from '@/features/payments/types/connect';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, fontSize, radii, shadows, spacing } from '@/theme';

interface StatusPresentation {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  body: string;
  action: 'start' | 'continue' | 'refresh' | 'support' | null;
  actionLabel: string | null;
}

const presentation = (status: SellerPayoutStatus | null): StatusPresentation => {
  switch (status?.onboardingStatus) {
    case 'created':
    case 'onboarding_incomplete':
      return {
        icon: 'time-outline', color: colors.warning, title: 'Payout setup incomplete',
        body: 'Continue Stripe’s secure onboarding to provide the remaining information.',
        action: 'continue', actionLabel: 'Continue setup',
      };
    case 'details_submitted_pending':
      return {
        icon: 'hourglass-outline', color: colors.info, title: 'Verification pending',
        body: 'Stripe is reviewing your information. You can refresh this status at any time.',
        action: 'refresh', actionLabel: 'Refresh status',
      };
    case 'enabled':
      return {
        icon: 'checkmark-circle-outline', color: colors.success, title: 'Payouts enabled',
        body: 'Your seller account is eligible to receive future marketplace transfers after an order becomes eligible.',
        action: 'refresh', actionLabel: 'Refresh status',
      };
    case 'restricted':
      return {
        icon: 'alert-circle-outline', color: colors.warning, title: 'More information required',
        body: 'Stripe may need updated information before your seller account can receive transfers.',
        action: status.needsOnboarding ? 'continue' : 'refresh',
        actionLabel: status.needsOnboarding ? 'Continue setup' : 'Refresh status',
      };
    case 'disabled':
      return {
        icon: 'close-circle-outline', color: colors.primary, title: 'Payout setup unavailable',
        body: 'This seller payout account cannot currently be used. Contact support for help.',
        action: 'support', actionLabel: 'Contact support',
      };
    case 'not_created':
    default:
      return {
        icon: 'wallet-outline', color: colors.info, title: 'Set up seller payouts',
        body: 'Stripe securely handles identity verification and bank information. Shedmo never stores your bank details.',
        action: 'start', actionLabel: 'Set up payouts',
      };
  }
};

export function SellerPayoutScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<SellerPayoutStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<StatusPresentation['action'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestActive = useRef(false);

  const refresh = useCallback(async (showLoader = false) => {
    if (requestActive.current) return;
    requestActive.current = true;
    if (showLoader) setLoading(true);
    setError(null);
    try {
      setStatus(await refreshConnectAccount());
    } catch {
      setError('Could not refresh payout status. Check your connection and try again.');
    } finally {
      requestActive.current = false;
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh(true);
  }, [refresh]));

  const openOnboarding = async () => {
    if (requestActive.current) return;
    requestActive.current = true;
    setAction(status?.onboardingStatus === 'not_created' || !status ? 'start' : 'continue');
    setError(null);
    try {
      const nextStatus = await createOrGetConnectAccount();
      setStatus(nextStatus);
      if (nextStatus.onboardingStatus === 'disabled') {
        setError('Payout setup is temporarily unavailable. Contact support for help.');
        return;
      }
      const link = await createConnectOnboardingLink();
      await Linking.openURL(link.url);
    } catch {
      setError('Could not start payout setup. Please try again.');
    } finally {
      requestActive.current = false;
      setAction(null);
    }
  };

  const current = presentation(status);
  const busy = action !== null;
  const handleAction = () => {
    if (current.action === 'start' || current.action === 'continue') void openOnboarding();
    else if (current.action === 'refresh') {
      setAction('refresh');
      void refresh().finally(() => setAction(null));
    } else if (current.action === 'support') router.push('/help-support');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="Seller Payouts" />
      <ScrollView contentContainerStyle={styles.content}>
        {loading && !status ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loadingText}>Checking payout status…</Text>
          </View>
        ) : (
          <>
            <View style={styles.statusCard}>
              <View style={[styles.icon, { backgroundColor: `${current.color}18` }]}>
                <Ionicons color={current.color} name={current.icon} size={34} />
              </View>
              <Text style={styles.title}>{current.title}</Text>
              <Text style={styles.body}>{current.body}</Text>
              {current.action && current.actionLabel ? (
                <Pressable
                  disabled={busy}
                  onPress={handleAction}
                  style={({ pressed }) => [styles.primary, pressed && !busy && styles.pressed, busy && styles.disabled]}
                >
                  {busy ? <ActivityIndicator color={colors.white} size="small" /> : null}
                  <Text style={styles.primaryText}>{busy ? 'Please wait…' : current.actionLabel}</Text>
                </Pressable>
              ) : null}
            </View>

            {error ? (
              <View style={styles.errorCard}>
                <Ionicons color={colors.primary} name="alert-circle-outline" size={20} />
                <Text style={styles.errorText}>{error}</Text>
                <Pressable disabled={busy} onPress={() => void refresh()}>
                  <Text style={styles.retry}>Retry</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>How seller payouts work</Text>
              <InfoRow icon="shield-checkmark-outline" text="Stripe collects and verifies identity and bank information securely." />
              <InfoRow icon="lock-closed-outline" text="Bank details and identity documents are never stored in this app." />
              <InfoRow icon="cash-outline" text="Completing setup makes future eligible sales transferable; it does not create a charge or payment." />
              <InfoRow icon="flask-outline" text="Seller onboarding is currently configured for Stripe test mode only." />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons color={colors.textSecondary} name={icon} size={19} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxxl },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 320 },
  loadingText: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.body, marginTop: spacing.md },
  statusCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl, ...shadows.card },
  icon: { alignItems: 'center', borderRadius: radii.round, height: 68, justifyContent: 'center', width: 68 },
  title: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.title, marginTop: spacing.lg, textAlign: 'center' },
  body: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.sm, textAlign: 'center' },
  primary: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: radii.md, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.xl, minHeight: 52 },
  primaryText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
  errorCard: { alignItems: 'center', backgroundColor: '#FFF1F0', borderRadius: radii.md, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md },
  errorText: { color: colors.text, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 19 },
  retry: { color: colors.primary, fontFamily: fontFamily.bold, fontSize: fontSize.bodySmall },
  infoCard: { backgroundColor: colors.surface, borderRadius: radii.lg, marginTop: spacing.lg, padding: spacing.lg },
  infoTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body, marginBottom: spacing.md },
  infoRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  infoText: { color: colors.textSecondary, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 20 },
});

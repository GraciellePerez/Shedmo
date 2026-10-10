import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';
import { usePushNotifications } from '@/features/notifications/hooks/usePushNotifications';

import { BlockedUsersScreen } from '@/features/blocking/BlockedUsersScreen';
import { LegalDocumentScreen } from '@/features/legal/LegalDocumentScreen';
import { isLegalSlug } from '@/features/legal/legalDocuments';

const content: Record<string, { title: string; icon: keyof typeof Ionicons.glyphMap; body: string; points: string[] }> = {
  account: { title: 'Account', icon: 'person-circle-outline', body: 'Your Shedmo account uses secure authentication.', points: ['Email verification is supported', 'Password reset is available', 'Never share account credentials'] },
  location: { title: 'Location', icon: 'location-outline', body: 'Shedmo location supports city/state and optional device location for distance results.', points: ['Edit location from your profile', 'Location permission is optional', 'Only share the precision needed for marketplace use'] },
  addresses: { title: 'Addresses', icon: 'map-outline', body: 'A saved-address manager is not included in this private beta.', points: ['Shipping is seller-managed', 'Confirm delivery details through the trusted order workflow', 'Do not send sensitive information unnecessarily'] },
  'payment-methods': { title: 'Payment Methods', icon: 'card-outline', body: 'Private-beta checkout uses Stripe test mode.', points: ['The marketplace does not store card details', 'No live-money card should be used', 'Stripe test cards only'] },
  privacy: { title: 'Privacy', icon: 'eye-off-outline', body: 'Control how your future marketplace activity may be displayed.', points: ['Profile visibility', 'Activity visibility', 'Data controls are placeholders'] },
  security: { title: 'Security', icon: 'shield-checkmark-outline', body: 'Authentication, verified sessions, and row-level data access are enabled.', points: ['Password reset is available', 'Two-factor authentication is not yet offered', 'Never share payment details or passwords in messages'] },
  appearance: { title: 'Appearance', icon: 'color-palette-outline', body: 'The prototype currently follows its standard light marketplace theme.', points: ['Light appearance active', 'Dark mode is not implemented', 'System theme support is planned'] },
  'refund-policy': { title: 'Refund & Cancellation Policy', icon: 'return-down-back-outline', body: 'Draft — not final legal text. Eligibility depends on fulfillment state, inspection windows, disputes, and the server-authoritative financial record.', points: ['Never promise an off-platform refund', 'Processing costs may affect seller liabilities', 'Final policy requires legal review'] },
  'dispute-policy': { title: 'Dispute Policy', icon: 'shield-outline', body: 'Draft — not final legal text. Buyers may open eligible order disputes and sellers may respond; staff resolution uses the trusted D3 workflow.', points: ['Payout remains frozen during an open dispute', 'Evidence is stored privately', 'Final standards require legal review'] },
  'seller-fees': { title: 'Seller Fees & Processing', icon: 'receipt-outline', body: 'Draft disclosure — not final legal text. Seller proceeds are calculated from trusted order records.', points: ['Marketplace fee: 4% on the first $1,000 of item price and 2% above, with a $1 minimum', 'Actual Stripe processing cost is seller-paid', 'Shipping responsibility remains with the seller for seller-managed shipping'] },
  about: { title: 'About', icon: 'information-circle-outline', body: 'Shedmo connects people buying and selling tools, parts, and equipment locally.', points: ['Message sellers directly', 'Arrange local pickup', 'Version 1.0.0'] },
};

export function SettingDetailScreen({ slug }: { slug: string }) {
  if (slug === 'blocked-users') return <BlockedUsersScreen />;
  if (isLegalSlug(slug)) return <LegalDocumentScreen key={slug} slug={slug} />;
  if (slug === 'push-notifications') return <PushNotificationSettings />;
  const item = content[slug] ?? { title: 'Settings', icon: 'settings-outline' as const, body: 'This setting is an explanatory placeholder.', points: ['No backend behavior is connected'] };
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title={item.title} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.icon}><Ionicons color={colors.primary} name={item.icon} size={30} /></View>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.body}>{item.body}</Text>
          <View style={styles.points}>
            {item.points.map((point) => <View key={point} style={styles.point}><Ionicons color={colors.success} name="checkmark-circle" size={18} /><Text style={styles.pointText}>{point}</Text></View>)}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PushNotificationSettings() {
  const push = usePushNotifications();
  const enabled = push.permission === 'granted' && push.registered;
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="Push Notifications" />
      <View style={styles.content}>
        <View style={styles.card}>
          <View style={styles.icon}><Ionicons color={colors.primary} name="notifications-outline" size={30} /></View>
          <Text style={styles.title}>{enabled ? 'Push enabled' : 'Push disabled'}</Text>
          <Text style={styles.body}>
            {push.permission === 'unavailable'
              ? 'Push notifications are unavailable on this device or app runtime.'
              : enabled
                ? 'This device can receive marketplace message and favorite alerts.'
                : 'Enable push notifications to receive important marketplace activity.'}
          </Text>
          {push.error ? <Text style={styles.pushError}>{push.error}</Text> : null}
          {!enabled && push.permission !== 'unavailable' ? (
            <Pressable disabled={push.loading} onPress={() => void push.enable()} style={styles.pushButton}>
              <Text style={styles.pushButtonText}>{push.loading ? 'Enabling…' : 'Enable Push Notifications'}</Text>
            </Pressable>
          ) : null}
          {push.permission === 'denied' ? (
            <Pressable onPress={() => void push.openSettings()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Open System Settings</Text>
            </Pressable>
          ) : null}
          {enabled ? (
            <Pressable onPress={() => void push.disableOnDevice()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Disable on This Device</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg },
  card: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xxl },
  icon: { alignItems: 'center', backgroundColor: '#FFF1F0', borderRadius: radii.round, height: 64, justifyContent: 'center', width: 64 },
  title: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.title, marginTop: spacing.lg },
  body: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.sm, textAlign: 'center' },
  points: { alignSelf: 'stretch', marginTop: spacing.xl },
  point: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm },
  pointText: { color: colors.text, flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, lineHeight: 19 },
  pushError: { color: colors.primary, fontFamily: fontFamily.medium, marginTop: spacing.md, textAlign: 'center' },
  pushButton: { backgroundColor: colors.primary, borderRadius: radii.md, marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  pushButtonText: { color: colors.white, fontFamily: fontFamily.bold },
  secondaryButton: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  secondaryButtonText: { color: colors.text, fontFamily: fontFamily.semibold },
});

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';
import { fetchStaffRole, type StaffRole } from '@/features/admin/adminRepository';
import Constants from 'expo-constants';
import { PROTECTED_CHECKOUT_ENABLED } from '@/config/launchFeatures';

type IconName = ComponentProps<typeof Ionicons>['name'];
interface SettingItem { label: string; icon: IconName; route?: '/edit-profile' | '/notifications' | '/help-support' | '/settings/payouts' | '/settings/delete-account' | '../beta-feedback'; slug?: string }

const sections: { title: string; data: SettingItem[] }[] = [
  { title: 'Account', data: [
    { label: 'Account', icon: 'person-circle-outline', slug: 'account' },
    { label: 'Profile', icon: 'person-outline', route: '/edit-profile' },
    { label: 'Location', icon: 'location-outline', slug: 'location' },
    ...(PROTECTED_CHECKOUT_ENABLED ? [
      { label: 'Payment Methods', icon: 'card-outline', slug: 'payment-methods' },
      { label: 'Seller Payouts', icon: 'wallet-outline', route: '/settings/payouts' },
    ] satisfies SettingItem[] : []),
  ] },
  { title: 'Preferences', data: [
    { label: 'Notifications', icon: 'notifications-outline', route: '/notifications' },
    { label: 'Push Notifications', icon: 'phone-portrait-outline', slug: 'push-notifications' },
    { label: 'Blocked Users', icon: 'ban-outline', slug: 'blocked-users' },
    { label: 'Security', icon: 'shield-checkmark-outline', slug: 'security' },
    { label: 'Delete Account', icon: 'trash-outline', route: '/settings/delete-account' },
  ] },
  { title: 'Support', data: [
    { label: 'Feedback', icon: 'chatbox-ellipses-outline', route: '../beta-feedback' },
    { label: 'Help and Support', icon: 'help-circle-outline', route: '/help-support' },
    { label: 'Terms', icon: 'document-text-outline', slug: 'terms' },
    { label: 'Privacy Policy', icon: 'lock-closed-outline', slug: 'privacy-policy' },
    { label: 'Prohibited Items', icon: 'ban-outline', slug: 'prohibited-items' },
    ...(PROTECTED_CHECKOUT_ENABLED ? [
      { label: 'Refund & Cancellation', icon: 'return-down-back-outline', slug: 'refund-policy' },
      { label: 'Dispute Policy', icon: 'shield-outline', slug: 'dispute-policy' },
      { label: 'Seller Fees & Processing', icon: 'receipt-outline', slug: 'seller-fees' },
    ] satisfies SettingItem[] : []),
    { label: 'About', icon: 'information-circle-outline', slug: 'about' },
  ] },
];

export function SettingsScreen() {
  const router = useRouter();
  const { signOut, signingOut } = useAuthStore();
  const signOutRequest = useRef(false);
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  useEffect(() => { let active=true; void fetchStaffRole().then((role)=>{if(active)setStaffRole(role);}); return()=>{active=false;}; }, []);
  const open = (item: SettingItem) => {
    if (item.route) router.push(item.route);
    else if (item.slug) router.push({ pathname: '/settings/[slug]', params: { slug: item.slug } });
  };

  const handleSignOut = useCallback(async () => {
    if (signOutRequest.current) return;
    signOutRequest.current = true;
    try {
      const result = await signOut();
      if (result.error) {
        Alert.alert('Unable to sign out', 'Sign out could not be completed. Please try again.');
        return;
      }
      router.replace('/(auth)');
    } finally {
      signOutRequest.current = false;
    }
  }, [router, signOut]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="Settings" />
      <SectionList
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(item) => item.label}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item, index, section }) => (
          <Pressable onPress={() => open(item)} style={({ pressed }) => [styles.row, index < section.data.length - 1 && styles.divider, pressed && styles.pressed]}>
            <View style={styles.icon}><Ionicons color={colors.text} name={item.icon} size={19} /></View>
            <Text style={styles.label}>{item.label}</Text>
            <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
          </Pressable>
        )}
        ListFooterComponent={
          <>
            {staffRole ? <Pressable onPress={() => router.push('../admin')} style={styles.admin}><Ionicons color={colors.info} name="shield-checkmark-outline" size={19}/><View style={styles.adminCopy}><Text style={styles.adminTitle}>Admin & Moderation</Text><Text style={styles.adminMeta}>{staffRole}</Text></View><Ionicons color={colors.textMuted} name="chevron-forward" size={18}/></Pressable> : null}
            <Pressable disabled={signingOut} onPress={() => Alert.alert('Sign Out', 'Sign out of this device?', [
              { style: 'cancel', text: 'Cancel' },
              {
                style: 'destructive',
                text: 'Sign Out',
                onPress: () => void handleSignOut(),
              },
            ])} style={({ pressed }) => [styles.signOut, pressed && !signingOut && styles.pressed, signingOut && styles.disabled]}>
              <Ionicons color={colors.primary} name="log-out-outline" size={19} />
              <Text style={styles.signOutText}>{signingOut ? 'Signing Out…' : 'Sign Out'}</Text>
            </Pressable>
            <Text style={styles.build}>Version {Constants.expoConfig?.version ?? '1.0.0'} · Build {Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? '1'}</Text>
            <Text style={styles.version}>Shedmo · Local marketplace</Text>
          </>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, paddingBottom: spacing.xxxl },
  sectionTitle: { color: colors.textSecondary, fontFamily: fontFamily.bold, fontSize: fontSize.caption, letterSpacing: 0.7, paddingBottom: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.xl, textTransform: 'uppercase' },
  row: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', minHeight: 58, paddingHorizontal: spacing.lg },
  divider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  pressed: { backgroundColor: colors.background },
  disabled: { opacity: 0.55 },
  icon: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.sm, height: 34, justifyContent: 'center', width: 34 },
  label: { color: colors.text, flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.body, marginLeft: spacing.md },
  signOut: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl, minHeight: 58, paddingHorizontal: spacing.xl },
  signOutText: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.body },
  version: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, padding: spacing.xl, textAlign: 'center' },
  build: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, paddingTop: spacing.sm, textAlign: 'center' },
  admin: { alignItems:'center',backgroundColor:colors.surface,flexDirection:'row',gap:spacing.md,marginTop:spacing.xl,minHeight:58,paddingHorizontal:spacing.xl },
  adminCopy:{flex:1},adminTitle:{color:colors.text,fontFamily:fontFamily.semibold},adminMeta:{color:colors.textSecondary,fontFamily:fontFamily.regular,fontSize:fontSize.caption,marginTop:2,textTransform:'capitalize'},
});

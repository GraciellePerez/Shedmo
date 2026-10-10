import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListingCard } from '@/components/ListingCard';
import { useListingStore } from '@/features/listings/store/ListingStore';
import { ProfileHero } from '@/features/profile/components/ProfileHero';
import { ProfileMenuRow } from '@/features/profile/components/ProfileMenuRow';
import { useProfileStore } from '@/features/profile/store/ProfileStore';
import { useFavoritesStore } from '@/features/favorites/store/FavoritesStore';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';
import { useNotificationStore } from '@/features/notifications/store/NotificationStore';
import { fetchPublicSellerProfile } from '@/features/sellers/services/sellerRepository';
import type { PublicSellerProfile } from '@/features/sellers/types/sellerProfile';
import { PROTECTED_CHECKOUT_ENABLED } from '@/config/launchFeatures';

const protectedCheckoutMenus = [
  { icon: 'bag-check-outline', label: 'Purchases', route: '/purchases' },
  { icon: 'cash-outline', label: 'Sales', route: '/sales' },
] as const;
const secondaryMenus = [
  ...(PROTECTED_CHECKOUT_ENABLED ? protectedCheckoutMenus : []),
  { icon: 'notifications-outline', label: 'Notifications', route: '/notifications' },
  { icon: 'settings-outline', label: 'Settings', route: '/settings' },
  { icon: 'help-circle-outline', label: 'Help and Support', route: '/help-support' },
] as const;

export function ProfileScreen() {
  const router = useRouter();
  const { managedListings } = useListingStore();
  const { profile } = useProfileStore();
  const openReviews = () => {
    if (profile.id) router.push({ pathname: '/reviews/[sellerId]', params: { sellerId: profile.id } });
  };
  const { isPending, isSaved, toggleSaved } = useFavoritesStore();
  const { emailVerified, profileError, profileLoading, refreshProfile } = useAuthStore();
  const { unreadCount: notificationUnreadCount } = useNotificationStore();
  const [marketplaceStats, setMarketplaceStats] = useState<PublicSellerProfile | null>(null);
  const [statsError, setStatsError] = useState(false);
  const active = managedListings.filter((item) => item.status === 'active').map((item) => item.listing);
  const location = [profile.city, profile.state].filter(Boolean).join(', ');
  const profileSubtitle = [`@${profile.username}`, location].filter(Boolean).join(' · ');

  const loadMarketplaceStats = useCallback(() => {
    let active = true;
    if (!profile.id) return () => { active = false; };
    setStatsError(false);
    void fetchPublicSellerProfile(profile.id)
      .then((value) => { if (active) setMarketplaceStats(value); })
      .catch(() => { if (active) setStatsError(true); });
    return () => { active = false; };
  }, [profile.id]);
  useFocusEffect(loadMarketplaceStats);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <FlatList
        columnWrapperStyle={active.length ? styles.gridRow : undefined}
        contentContainerStyle={styles.content}
        data={active.slice(0, 4)}
        keyExtractor={(item) => item.id}
        numColumns={2}
        renderItem={({ item }) => (
          <View style={styles.gridItem}>
            <ListingCard
              listing={item}
              onPress={() => router.push({ pathname: '/listings/[id]', params: { id: item.id } })}
              onToggleSaved={() => toggleSaved(item.id)}
              favoritePending={isPending(item.id)}
              saved={isSaved(item.id)}
            />
          </View>
        )}
        ListHeaderComponent={
          <>
            <View style={styles.profileCard}>
              <ProfileHero
                onReviewsPress={openReviews}
                initials={profile.initials}
                name={profile.displayName}
                photoUri={profile.photoUri}
                rating={marketplaceStats?.averageRating ?? null}
                reviews={marketplaceStats?.totalReviews ?? 0}
                subtitle={profileSubtitle}
                verified={profile.verified}
              />
              {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
              {profile.postalCode ? (
                <View style={styles.privateLocation}>
                  <Ionicons color={colors.textSecondary} name="location-outline" size={15} />
                  <Text style={styles.privateLocationText}>
                    ZIP {profile.postalCode}
                  </Text>
                </View>
              ) : null}
              <View style={styles.actions}>
                <Pressable onPress={() => router.push('/edit-profile')} style={styles.secondaryButton}>
                  <Ionicons color={colors.text} name="create-outline" size={16} />
                  <Text style={styles.secondaryButtonText}>Edit Profile</Text>
                </Pressable>
                <Pressable
                  onPress={() => Share.share({ message: `Check out @${profile.username} on Shedmo.` })}
                  style={styles.secondaryButton}
                >
                  <Ionicons color={colors.text} name="share-outline" size={16} />
                  <Text style={styles.secondaryButtonText}>Share</Text>
                </Pressable>
              </View>
              <View style={styles.stats}>
                <Stat label="Verified Sales" value={marketplaceStats?.verifiedSalesCount ?? 0} />
                <Divider />
                <Stat label="Member Since" value={marketplaceStats ? new Date(marketplaceStats.memberSince).getFullYear() : '—'} />
                <Divider />
                <Stat label="Reviews" value={marketplaceStats?.totalReviews ?? 0} onPress={openReviews} />
              </View>
              <View style={styles.badge}>
                <Ionicons color={emailVerified ? colors.primary : colors.warning} name={emailVerified ? 'checkmark-circle' : 'mail-outline'} size={14} />
                <Text style={[styles.badgeText, !emailVerified && styles.pendingText]}>{emailVerified ? 'Email Verified' : 'Email Verification Pending'}</Text>
              </View>
              {profileLoading ? <Text style={styles.profileStatus}>Loading your Supabase profile…</Text> : null}
              {profileError ? (
                <Pressable onPress={refreshProfile} style={styles.profileError}>
                  <Text style={styles.profileErrorText}>{profileError} Tap to retry.</Text>
                </Pressable>
              ) : null}
              {statsError ? <Pressable onPress={() => { loadMarketplaceStats(); }} style={styles.profileError}><Text style={styles.profileErrorText}>Shedmo statistics are temporarily unavailable. Tap to retry.</Text></Pressable> : null}
            </View>

            <View style={styles.menu}>
              <ProfileMenuRow
                icon="pricetags-outline"
                label="My Listings"
                onPress={() => router.push('/my-listings')}
                subtitle={`${active.length} active`}
              />
              <ProfileMenuRow
                icon="heart-outline"
                label="Saved Items"
                last
                onPress={() => router.push('/saved-items')}
              />
            </View>
            <View style={styles.menu}>
              {secondaryMenus.map((item, index) => (
                <ProfileMenuRow
                  icon={item.icon}
                  key={item.label}
                  label={item.label}
                  subtitle={item.route === '/notifications' && notificationUnreadCount > 0
                    ? `${notificationUnreadCount} unread`
                    : undefined}
                  last={index === secondaryMenus.length - 1}
                  onPress={() => router.push(item.route)}
                />
              ))}
            </View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Active Listings</Text>
              <Pressable onPress={() => router.push('/my-listings')}>
                <Text style={styles.seeAll}>See All</Text>
              </Pressable>
            </View>
          </>
        }
        ListEmptyComponent={
          <Text style={styles.noListings}>Publish an item from Sell to see it here.</Text>
        }
      />
    </SafeAreaView>
  );
}

function Stat({ label, value, onPress }: { label: string; value: number | string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={styles.stat}>
      <Text numberOfLines={1} style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, flexGrow: 1, paddingBottom: spacing.xxl },
  profileCard: { backgroundColor: colors.surface, padding: spacing.xl },
  bio: { color: colors.text, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.md, textAlign: 'center' },
  privateLocation: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  privateLocationText: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  secondaryButton: { alignItems: 'center', backgroundColor: colors.background, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 42 },
  secondaryButtonText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  stats: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.lg, flexDirection: 'row', marginTop: spacing.md, paddingVertical: spacing.md },
  stat: { alignItems: 'center', flex: 1, minWidth: 0 },
  statValue: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.subtitle },
  statLabel: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: spacing.xxs },
  divider: { backgroundColor: colors.border, height: 29, width: StyleSheet.hairlineWidth },
  badge: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#FFF1F0', borderRadius: radii.round, flexDirection: 'row', gap: 5, marginTop: spacing.md, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { color: colors.primary, fontFamily: fontFamily.bold, fontSize: fontSize.footnote },
  menu: { backgroundColor: colors.surface, marginTop: spacing.md },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingBottom: spacing.md, paddingTop: spacing.xxl },
  sectionTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle },
  seeAll: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  gridRow: { paddingHorizontal: spacing.sm },
  gridItem: { flex: 1, marginBottom: spacing.md, marginHorizontal: spacing.sm, maxWidth: '50%' },
  noListings: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, padding: spacing.xl, textAlign: 'center' },
  pendingText: { color: colors.warning },
  profileStatus: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginTop: spacing.sm },
  profileError: { backgroundColor: '#FFF1F0', borderRadius: radii.md, marginTop: spacing.sm, padding: spacing.sm },
  profileErrorText: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, lineHeight: 17 },
});

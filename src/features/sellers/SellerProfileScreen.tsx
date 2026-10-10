import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockUserButton } from '@/features/blocking/BlockUserButton';
import { Avatar } from '@/components/Avatar';
import { ListingCard } from '@/components/ListingCard';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { useFavoritesStore } from '@/features/favorites/store/FavoritesStore';
import { useMessagingStore } from '@/features/messaging/store/MessagingStore';
import { ReportModal } from '@/features/reports/components/ReportModal';
import { useSellerProfile } from '@/features/sellers/store/useSellerProfile';
import type { Listing } from '@/models';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function SellerProfileScreen({ sellerId }: { sellerId: string }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const seller = useSellerProfile(sellerId);
  const favorites = useFavoritesStore();
  const messaging = useMessagingStore();
  const isOwnProfile = user?.id === sellerId;
  const [reportVisible, setReportVisible] = useState(false);

  const messageSeller = async () => {
    if (isOwnProfile) {
      router.push('/edit-profile');
      return;
    }
    const listing = seller.listings[0];
    if (!listing) {
      Alert.alert('No active listing', 'Start a conversation from one of this seller’s active listings.');
      return;
    }
    const result = await messaging.getOrCreateConversation(listing);
    if (result.id) router.push({ pathname: '/conversations/[id]', params: { id: result.id } });
    else Alert.alert('Conversation unavailable', result.error ?? 'Try again.');
  };

  if (seller.loading && !seller.profile) {
    return <State icon="hourglass-outline" message="Loading seller…" />;
  }
  if (seller.error && !seller.profile) {
    return <State action="Retry" icon="cloud-offline-outline" message={seller.error} onPress={() => void seller.retry()} />;
  }
  if (!seller.profile) {
    return <State action="Go Back" icon="person-outline" message="Seller unavailable" onPress={() => router.back()} />;
  }

  const profile = seller.profile;
  const initials = profile.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const location = [profile.city, profile.state].filter(Boolean).join(', ');

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        columnWrapperStyle={seller.listings.length ? styles.row : undefined}
        contentContainerStyle={styles.content}
        data={seller.listings}
        initialNumToRender={8}
        keyExtractor={(item) => item.id}
        ListFooterComponent={seller.loadingMore ? <ActivityIndicator color={colors.primary} style={styles.footer} /> : null}
        ListHeaderComponent={
          <>
            <View style={styles.nav}>
              <Pressable accessibilityLabel="Go back" hitSlop={10} onPress={() => router.back()}>
                <Ionicons color={colors.text} name="chevron-back" size={28} />
              </Pressable>
              <Text style={styles.navTitle}>Seller Profile</Text>
              <View style={styles.navSpacer} />
            </View>
            <View style={styles.hero}>
              <Avatar imageUri={profile.avatarUrl ?? undefined} initials={initials} size={88} />
              <Text style={styles.name}>{profile.displayName}</Text>
              {profile.username ? <Text style={styles.username}>@{profile.username}</Text> : null}
              {location ? <Text style={styles.location}>{location}</Text> : null}
              {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
              <Text style={styles.member}>Member since {formatMemberSince(profile.memberSince)}</Text>
              <View style={styles.stats}>
                <Stat label="Active" value={profile.activeListingCount} />
                <View style={styles.divider} />
                <Stat label="Sold" value={profile.soldListingCount} />
                <View style={styles.divider} />
                <Stat label="Verified sales" value={profile.verifiedSalesCount} />
              </View>
              <Pressable onPress={() => router.push({ pathname: '/reviews/[sellerId]', params: { sellerId } })} style={styles.ratingRow}>
                <Ionicons color={colors.warning} name="star" size={18} />
                <Text style={styles.ratingText}>{profile.averageRating?.toFixed(1) ?? 'New seller'} · {formatReviewCount(profile.totalReviews)}</Text>
                <Ionicons color={colors.textSecondary} name="chevron-forward" size={17} />
              </Pressable>
              <Pressable onPress={() => void messageSeller()} style={styles.primary}>
                <Ionicons color={colors.white} name={isOwnProfile ? 'create-outline' : 'chatbubble-outline'} size={18} />
                <Text style={styles.primaryText}>{isOwnProfile ? 'Edit Profile' : 'Message Seller'}</Text>
              </Pressable>
              {!isOwnProfile ? <BlockUserButton userId={sellerId} /> : null}
              {!isOwnProfile ? (
                <Pressable onPress={() => setReportVisible(true)} style={styles.report}>
                  <Ionicons color={colors.primary} name="flag-outline" size={17} />
                  <Text style={styles.reportText}>Report seller</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.heading}>
              <Text style={styles.headingText}>Active Listings</Text>
              <Text style={styles.count}>{profile.activeListingCount}</Text>
            </View>
            {seller.error ? (
              <Pressable onPress={() => void seller.refresh()} style={styles.inlineError}>
                <Text style={styles.inlineErrorText}>{seller.error} Tap to retry.</Text>
              </Pressable>
            ) : null}
          </>
        }
        maxToRenderPerBatch={8}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons color={colors.textSecondary} name="cube-outline" size={32} />
            <Text style={styles.emptyTitle}>No active listings</Text>
            <Text style={styles.emptyBody}>This seller has no publicly available listings right now.</Text>
          </View>
        }
        numColumns={2}
        onEndReached={() => void seller.loadMore()}
        onEndReachedThreshold={0.45}
        refreshControl={<RefreshControl onRefresh={() => void seller.refresh()} refreshing={seller.refreshing} tintColor={colors.primary} />}
        renderItem={({ item }: { item: Listing }) => (
          <View style={styles.item}>
            <ListingCard
              favoritePending={favorites.isPending(item.id)}
              listing={item}
              onPress={() => router.push({ pathname: '/listings/[id]', params: { id: item.id } })}
              onToggleSaved={() => void favorites.toggleSaved(item.id)}
              saved={favorites.isSaved(item.id)}
            />
          </View>
        )}
        windowSize={7}
      />
      <ReportModal
        onClose={() => setReportVisible(false)}
        target={{ type: 'seller', targetId: sellerId }}
        visible={reportVisible}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function State({ action, icon, message, onPress }: {
  action?: string; icon: keyof typeof Ionicons.glyphMap; message: string; onPress?: () => void;
}) {
  return (
    <SafeAreaView style={styles.state}>
      <Ionicons color={colors.textSecondary} name={icon} size={40} />
      <Text style={styles.stateText}>{message}</Text>
      {action ? <Pressable onPress={onPress} style={styles.stateButton}><Text style={styles.stateButtonText}>{action}</Text></Pressable> : null}
    </SafeAreaView>
  );
}

function formatMemberSince(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(value));
}

function formatReviewCount(count: number) {
  return `${count} ${count === 1 ? 'review' : 'reviews'}`;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, flexGrow: 1, paddingBottom: spacing.xxxl },
  nav: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: spacing.lg },
  navTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  navSpacer: { width: 28 },
  hero: { alignItems: 'center', backgroundColor: colors.surface, padding: spacing.xl },
  name: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 24, marginTop: spacing.md },
  username: { color: colors.textSecondary, fontFamily: fontFamily.medium, marginTop: spacing.xxs },
  location: { color: colors.text, fontFamily: fontFamily.medium, marginTop: spacing.sm },
  bio: { color: colors.text, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.md, textAlign: 'center' },
  member: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginTop: spacing.xs },
  stats: { backgroundColor: colors.background, borderRadius: radii.lg, flexDirection: 'row', marginTop: spacing.lg, paddingVertical: spacing.md, width: '100%' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 20 },
  statLabel: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: spacing.xxs },
  divider: { backgroundColor: colors.border, height: 32, width: StyleSheet.hairlineWidth },
  ratingRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.sm },
  ratingText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  primary: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.lg, minHeight: 50, width: '100%' },
  primaryText: { color: colors.white, fontFamily: fontFamily.bold },
  report: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md, padding: spacing.sm },
  reportText: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  heading: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, padding: spacing.xl },
  headingText: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle },
  count: { color: colors.textSecondary, fontFamily: fontFamily.medium },
  row: { paddingHorizontal: spacing.sm },
  item: { flex: 1, marginBottom: spacing.md, marginHorizontal: spacing.sm, maxWidth: '50%' },
  footer: { padding: spacing.xl },
  empty: { alignItems: 'center', padding: spacing.xxxl },
  emptyTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.md },
  emptyBody: { color: colors.textSecondary, fontFamily: fontFamily.regular, marginTop: spacing.sm, textAlign: 'center' },
  inlineError: { marginHorizontal: spacing.xl, marginBottom: spacing.md },
  inlineErrorText: { color: colors.primary, fontFamily: fontFamily.medium, textAlign: 'center' },
  state: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  stateText: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.md, textAlign: 'center' },
  stateButton: { backgroundColor: colors.primary, borderRadius: radii.md, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  stateButtonText: { color: colors.white, fontFamily: fontFamily.bold },
});

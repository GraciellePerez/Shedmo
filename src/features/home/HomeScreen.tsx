import { useBlockingStore } from '@/features/blocking/BlockingStore';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { FeaturedCard } from '@/components/FeaturedCard';
import { ListingCard } from '@/components/ListingCard';
import { SectionHeader } from '@/components/SectionHeader';
import { categories } from '@/data';
import { useListingStore } from '@/features/listings/store/ListingStore';
import { useProfileStore } from '@/features/profile/store/ProfileStore';
import { useFavoritesStore } from '@/features/favorites/store/FavoritesStore';
import { useNotificationStore } from '@/features/notifications/store/NotificationStore';
import { fetchRecentlyViewedListings } from '@/features/listings/services/listingRepository';
import { getLocalTimeGreeting } from '@/features/home/homeGreeting';
import type { Listing } from '@/models';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function HomeScreen() {
  const router = useRouter();
  const { blockedIds, revision: blockingRevision } = useBlockingStore();
  const { error, hasMore, listings, loadMore, loading, loadingMore, refresh } = useListingStore();
  const { profile } = useProfileStore();
  const { isPending, isSaved, toggleSaved } = useFavoritesStore();
  const { unreadCount: notificationUnreadCount } = useNotificationStore();
  const [activeCategory, setActiveCategory] = useState('all');
  const [recentlyViewed, setRecentlyViewed] = useState<Listing[]>([]);

  useFocusEffect(useCallback(() => {
    let active = true;
    void fetchRecentlyViewedListings().then((items) => { if (active) setRecentlyViewed(items); }).catch(() => undefined);
    return () => { active = false; };
  // Refresh cached history after a block change as well as on screen focus.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockingRevision]));

  const featured = useMemo(
    () => listings.filter((item) => item.seller.verified).slice(0, 4),
    [listings],
  );
  const recent = useMemo(
    () => activeCategory === 'all' ? listings : listings.filter((item) => item.category === activeCategory),
    [activeCategory, listings],
  );

  const openListing = (id: string) => {
    router.push({ pathname: '/listings/[id]', params: { id } });
  };

  const renderListing = ({ item }: { item: Listing }) => (
    <View style={styles.gridItem}>
      <ListingCard
        listing={item}
        onPress={() => openListing(item.id)}
        onSellerPress={() => router.push({ pathname: '/sellers/[id]', params: { id: item.seller.id } })}
        onToggleSaved={() => toggleSaved(item.id)}
        favoritePending={isPending(item.id)}
        saved={isSaved(item.id)}
      />
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.content}
        data={recent}
        initialNumToRender={8}
        keyExtractor={(item) => item.id}
        maxToRenderPerBatch={8}
        numColumns={2}
        renderItem={renderListing}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
        windowSize={7}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View style={styles.headerRow}>
                <View>
                  <Text style={styles.greeting}>{getLocalTimeGreeting()}</Text>
                  <Text style={styles.brand}>Shedmo</Text>
                </View>
                <View style={styles.headerActions}>
                  <Pressable accessibilityLabel="Notifications" onPress={() => router.push('/notifications')} style={styles.iconButton}>
                    <Ionicons color={colors.text} name="notifications-outline" size={23} />
                    {notificationUnreadCount > 0 ? (
                      <View style={styles.notificationDot}>
                        <Text style={styles.notificationCount}>
                          {notificationUnreadCount > 9 ? '9+' : notificationUnreadCount}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Your profile"
                    accessibilityRole="button"
                    onPress={() => router.navigate('/(tabs)/profile')}
                  >
                    <Avatar imageUri={profile.photoUri} initials={profile.initials} />
                  </Pressable>
                </View>
              </View>
              <Pressable accessibilityRole="search" onPress={() => router.push('/(tabs)/browse')} style={styles.search}>
                <Ionicons color={colors.textSecondary} name="search" size={18} />
                <Text style={styles.searchText}>Search tools, parts & equipment...</Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.categories}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryStrip}
            >
              {categories.map((category) => {
                const active = category.id === activeCategory;
                return (
                  <Pressable
                    key={category.id}
                    onPress={() => setActiveCategory(category.id)}
                    style={[styles.category, active && styles.categoryActive]}
                  >
                    <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                      {category.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.section}>
              <SectionHeader title="Featured" onSeeAll={() => router.push('/(tabs)/browse')} />
              <ScrollView
                contentContainerStyle={styles.featuredContent}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {featured.map((item) => (
                  <FeaturedCard
                    key={item.id}
                    listing={item}
                    onPress={() => openListing(item.id)}
                    onToggleSaved={() => toggleSaved(item.id)}
                    saved={isSaved(item.id)}
                  />
                ))}
              </ScrollView>
            </View>

            {recentlyViewed.some(item => !blockedIds.has(item.seller.id)) ? (
              <View style={styles.section}>
                <SectionHeader title="Recently Viewed" onSeeAll={() => undefined} />
                <ScrollView contentContainerStyle={styles.recentlyViewedContent} horizontal showsHorizontalScrollIndicator={false}>
                  {recentlyViewed.filter(item => !blockedIds.has(item.seller.id)).map((item) => <View key={item.id} style={styles.recentlyViewedItem}><ListingCard listing={item} onPress={() => openListing(item.id)} onToggleSaved={() => toggleSaved(item.id)} favoritePending={isPending(item.id)} saved={isSaved(item.id)} /></View>)}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.recentHeader}>
              <SectionHeader title="Recent Listings" onSeeAll={() => router.push('/(tabs)/browse')} />
            </View>
          </>
        }
        ListEmptyComponent={loading ? null : (
          <View style={styles.emptyState}>
            <Ionicons
              color={colors.textSecondary}
              name={error ? 'cloud-offline-outline' : 'storefront-outline'}
              size={34}
            />
            <Text style={styles.emptyTitle}>
              {error ? "Couldn't load listings" : 'No active listings yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {error ?? 'New marketplace listings will appear here.'}
            </Text>
            {error ? (
              <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        ListFooterComponent={loadingMore ? <Text style={styles.loadingMore}>Loading more…</Text> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, paddingBottom: spacing.xxl },
  emptyState: { alignItems: 'center', marginHorizontal: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
  emptyTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.md, textAlign: 'center' },
  emptyBody: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 21, marginTop: spacing.xs, textAlign: 'center' },
  retryButton: { backgroundColor: colors.primary, borderRadius: radii.md, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  loadingMore: { color: colors.textSecondary, fontFamily: fontFamily.medium, padding: spacing.lg, textAlign: 'center' },
  header: { backgroundColor: colors.surface, paddingBottom: spacing.lg, paddingHorizontal: spacing.xl },
  headerRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg },
  greeting: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall },
  brand: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.display, letterSpacing: -0.5, lineHeight: 26 },
  brandAccent: { color: colors.primary },
  headerActions: { flexDirection: 'row', gap: spacing.md },
  iconButton: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.round, height: 40, justifyContent: 'center', width: 40 },
  notificationDot: { alignItems: 'center', backgroundColor: colors.primary, borderColor: colors.surface, borderRadius: radii.round, borderWidth: 2, minHeight: 17, justifyContent: 'center', minWidth: 17, paddingHorizontal: 2, position: 'absolute', right: 2, top: 1 },
  notificationCount: { color: colors.white, fontFamily: fontFamily.bold, fontSize: 8 },
  search: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.md, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: 14, paddingVertical: spacing.md },
  searchText: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body },
  categoryStrip: { backgroundColor: colors.surface, borderTopColor: colors.background, borderTopWidth: 1 },
  categories: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: 10 },
  category: { backgroundColor: colors.background, borderRadius: radii.round, paddingHorizontal: spacing.lg, paddingVertical: 7 },
  categoryActive: { backgroundColor: colors.text },
  categoryText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  categoryTextActive: { color: colors.white },
  section: { marginTop: spacing.xl },
  featuredContent: { gap: spacing.md, paddingBottom: spacing.xs, paddingHorizontal: spacing.xl },
  recentHeader: { marginTop: spacing.xxl },
  recentlyViewedContent: { gap: spacing.md, paddingHorizontal: spacing.xl },
  recentlyViewedItem: { width: 176 },
  gridItem: { flex: 1, marginBottom: spacing.md, marginHorizontal: spacing.sm },
});

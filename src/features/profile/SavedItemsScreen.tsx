import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListingCard } from '@/components/ListingCard';
import { useFavoritesStore } from '@/features/favorites/store/FavoritesStore';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { calculateDistanceMiles } from '@/features/location/formatDistance';
import { useLocationStore } from '@/features/location/store/LocationStore';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

type Sort = 'Recently Saved' | 'Price: Low' | 'Price: High';
type DistanceFilter = 5 | 10 | 25 | 50 | null;

const distanceFilters: { label: string; value: DistanceFilter }[] = [
  { label: 'Any distance', value: null },
  { label: 'Within 5 mi', value: 5 },
  { label: 'Within 10 mi', value: 10 },
  { label: 'Within 25 mi', value: 25 },
  { label: 'Within 50 mi', value: 50 },
];

export function SavedItemsScreen() {
  const router = useRouter();
  const locationStore = useLocationStore();
  const {
    error, favoriteListings, hasMore, isPending, loadMore, loading, loadingMore,
    refresh, refreshing, toggleSaved,
  } = useFavoritesStore();
  const [sort, setSort] = useState<Sort>('Recently Saved');
  const [distanceFilter, setDistanceFilter] = useState<DistanceFilter>(null);

  const coordinates = useMemo(() => locationStore.location?.latitude != null
    && locationStore.location.longitude != null
    ? {
      latitude: locationStore.location.latitude,
      longitude: locationStore.location.longitude,
    }
    : null, [locationStore.location?.latitude, locationStore.location?.longitude]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  const saved = useMemo(() => {
    const withDistance = favoriteListings.map((item) => {
      const distanceMiles = calculateDistanceMiles(coordinates, item.listing);
      return { ...item, listing: { ...item.listing, distanceMiles } };
    });
    const filtered = withDistance.filter(({ listing }) => distanceFilter == null
      || (listing.distanceMiles != null && listing.distanceMiles <= distanceFilter));
    return [...filtered].sort((a, b) => sort === 'Price: Low'
      ? a.listing.price - b.listing.price
      : sort === 'Price: High'
        ? b.listing.price - a.listing.price
        : new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }, [coordinates, distanceFilter, favoriteListings, sort]);

  const cycleSort = () => setSort((current) => current === 'Recently Saved'
    ? 'Price: Low'
    : current === 'Price: Low' ? 'Price: High' : 'Recently Saved');

  const selectDistance = (next: DistanceFilter) => {
    if (next == null || coordinates) {
      setDistanceFilter(next);
      return;
    }
    Alert.alert(
      'Location required',
      'Choose your current location to filter saved listings by distance.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Use Current Location',
          onPress: () => void locationStore.useCurrentLocation().then((resolved) => {
            if (resolved) setDistanceFilter(next);
          }),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="Saved Items" />
      <View style={styles.controls}>
        <Pressable onPress={cycleSort} style={styles.sort}>
          <Ionicons color={colors.text} name="swap-vertical-outline" size={17} />
          <Text numberOfLines={1} style={styles.sortText}>{sort}</Text>
        </Pressable>
        <ScrollView contentContainerStyle={styles.filters} horizontal showsHorizontalScrollIndicator={false}>
          {distanceFilters.map((item) => (
            <Pressable key={item.label} onPress={() => selectDistance(item.value)} style={[styles.filter, distanceFilter === item.value && styles.activeFilter]}>
              <Text style={[styles.filterText, distanceFilter === item.value && styles.activeFilterText]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {error && saved.length ? (
        <Pressable onPress={() => void refresh()} style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>{error} Tap to retry.</Text>
        </Pressable>
      ) : null}
      <FlatList
        columnWrapperStyle={saved.length ? styles.gridRow : undefined}
        contentContainerStyle={[styles.content, !saved.length && styles.emptyContent]}
        data={saved}
        keyExtractor={(item) => item.listing.id}
        numColumns={2}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.5}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons color={colors.textSecondary} name={loading ? 'hourglass-outline' : 'heart-outline'} size={35} />
            </View>
            <Text style={styles.emptyTitle}>
              {loading ? 'Loading saved items…' : error ? 'Saved items unavailable' : 'No saved items'}
            </Text>
            <Text style={styles.emptyBody}>
              {loading
                ? 'Restoring your saved marketplace listings.'
                : error
                  ? error
                  : distanceFilter == null
                    ? 'Tap the heart on a listing to keep it here.'
                    : `No saved items with a known location are within ${distanceFilter} miles.`}
            </Text>
            {error ? (
              <Pressable onPress={() => void refresh()} style={styles.browseButton}>
                <Text style={styles.browseButtonText}>Retry</Text>
              </Pressable>
            ) : !loading ? (
              <Pressable onPress={() => router.navigate('/(tabs)/browse')} style={styles.browseButton}>
                <Text style={styles.browseButtonText}>Browse Shedmo</Text>
              </Pressable>
            ) : null}
          </View>
        }
        ListFooterComponent={loadingMore ? <Text style={styles.footer}>Loading more…</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.gridItem}>
            <ListingCard
              favoritePending={isPending(item.listing.id)}
              listing={item.listing}
              listingStatus={item.status}
              onPress={() => router.push({ pathname: '/listings/[id]', params: { id: item.listing.id } })}
              onSellerPress={() => router.push({
                pathname: '/sellers/[id]', params: { id: item.listing.seller.id },
              })}
              onToggleSaved={() => void toggleSaved(item.listing.id)}
              saved
            />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  controls: { backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sort: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, height: 40, paddingHorizontal: spacing.md },
  sortText: { color: colors.text, flex: 1, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  filters: { gap: spacing.sm, paddingTop: spacing.sm },
  filter: { backgroundColor: colors.background, borderRadius: radii.round, paddingHorizontal: spacing.lg, paddingVertical: 7 },
  activeFilter: { backgroundColor: colors.text },
  filterText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.footnote },
  activeFilterText: { color: colors.white },
  content: { backgroundColor: colors.background, flexGrow: 1, paddingBottom: spacing.xxxl, paddingTop: spacing.lg },
  emptyContent: { justifyContent: 'center' },
  gridRow: { paddingHorizontal: spacing.sm },
  gridItem: { flex: 1, marginBottom: spacing.md, marginHorizontal: spacing.sm, maxWidth: '50%' },
  empty: { alignItems: 'center', padding: spacing.xxxl },
  emptyIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 35, height: 70, justifyContent: 'center', width: 70 },
  emptyTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.lg },
  emptyBody: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.sm, textAlign: 'center' },
  browseButton: { backgroundColor: colors.primary, borderRadius: 13, marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  browseButtonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.bodySmall },
  footer: { color: colors.textSecondary, fontFamily: fontFamily.medium, padding: spacing.lg, textAlign: 'center' },
  inlineError: { backgroundColor: '#FFF1F0', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  inlineErrorText: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, textAlign: 'center' },
});

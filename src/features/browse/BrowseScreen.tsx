import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListingCard } from '@/components/ListingCard';
import { BrowseFilterModal } from '@/features/browse/components/BrowseFilterModal';
import { BrowseSearchBar } from '@/features/browse/components/BrowseSearchBar';
import { FilterChip } from '@/features/browse/components/FilterChip';
import { useBrowseStore } from '@/features/browse/store/BrowseStore';
import type { ListingSortOption } from '@/features/browse/types/search';
import { useFavoritesStore } from '@/features/favorites/store/FavoritesStore';
import { useLocationStore } from '@/features/location/store/LocationStore';
import type { Listing } from '@/models';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

const sorts: { label: string; value: ListingSortOption }[] = [
  { label: 'Best match', value: 'relevance' },
  { label: 'Newest', value: 'newest' },
  { label: 'Closest', value: 'closest' },
  { label: 'Price: Low → High', value: 'price_asc' },
  { label: 'Price: High → Low', value: 'price_desc' },
];

export function BrowseScreen() {
  const router = useRouter();
  const browse = useBrowseStore();
  const location = useLocationStore();
  const favorites = useFavoritesStore();
  const listRef = useRef<FlatList<Listing>>(null);
  const [filtersVisible, setFiltersVisible] = useState(false);

  const activeFilterCount = [
    browse.filters.category, browse.filters.condition, browse.filters.minPrice,
    browse.filters.maxPrice, browse.filters.radius,
  ].filter((value) => value != null && value !== '').length;
  const filtered = Boolean(browse.filters.query || activeFilterCount);

  const setSort = (sort: ListingSortOption) => {
    if (sort === 'closest' && !location.location?.latitude) {
      Alert.alert(
        'Location required',
        'Closest sorting uses your marketplace location. Set it from the distance filter or use your current location.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Use Current Location', onPress: () => void location.useCurrentLocation() },
        ],
      );
      return;
    }
    browse.applyFilters({ ...browse.filters, sort });
    listRef.current?.scrollToOffset({ animated: false, offset: 0 });
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <BrowseFilterModal
        error={browse.filterError}
        filters={browse.filters}
        onApply={browse.applyFilters}
        onClose={() => setFiltersVisible(false)}
        visible={filtersVisible}
      />
      <FlatList
        ref={listRef}
        columnWrapperStyle={browse.items.length ? styles.row : undefined}
        contentContainerStyle={[styles.content, !browse.items.length && styles.grow]}
        data={browse.items}
        initialNumToRender={8}
        keyExtractor={(item) => item.id}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Browse</Text>
            <BrowseSearchBar
              onChangeText={browse.setQueryInput}
              onFilterPress={() => setFiltersVisible(true)}
              onSubmit={() => browse.applyFilters({ ...browse.filters, query: browse.queryInput.trim() })}
              value={browse.queryInput}
            />
            <ScrollView contentContainerStyle={styles.sorts} horizontal showsHorizontalScrollIndicator={false}>
              {sorts.map((sort) => (
                <FilterChip
                  active={browse.filters.sort === sort.value}
                  key={sort.value}
                  label={sort.label}
                  onPress={() => setSort(sort.value)}
                />
              ))}
            </ScrollView>
            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                {activeFilterCount ? `${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}` : 'All published listings'}
              </Text>
              {filtered ? <Pressable onPress={browse.clearFilters}><Text style={styles.clear}>Clear all</Text></Pressable> : null}
            </View>
            {!location.location?.latitude ? (
              <View style={styles.locationHint}>
                <Text style={styles.locationHintText}>Set a location to enable distance filters and closest sorting.</Text>
                <Pressable
                  onPress={() => Alert.alert(
                    'Use current location?',
                    'We request foreground location once to calculate approximate distances. Exact coordinates are never shown.',
                    [
                      { text: 'Not Now', style: 'cancel' },
                      { text: 'Continue', onPress: () => void location.useCurrentLocation() },
                    ],
                  )}
                >
                  <Text style={styles.locationAction}>Use current</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          browse.initialLoading ? (
            <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.body}>Searching listings…</Text></View>
          ) : browse.error ? (
            <Empty icon="cloud-offline-outline" title="Couldn’t load listings" body={browse.error} action="Retry" onPress={() => void browse.retry()} />
          ) : (
            <Empty
              icon="search-outline"
              title={filtered ? 'No matching listings' : 'No listings yet'}
              body={filtered ? 'Try broadening your search or clearing a filter.' : 'Published listings will appear here.'}
              action={filtered ? 'Clear filters' : undefined}
              onPress={browse.clearFilters}
            />
          )
        }
        ListFooterComponent={browse.loadingMore ? <ActivityIndicator color={colors.primary} style={styles.footer} /> : null}
        maxToRenderPerBatch={8}
        numColumns={2}
        onEndReached={() => void browse.loadMore()}
        onEndReachedThreshold={0.45}
        refreshControl={<RefreshControl onRefresh={() => void browse.refresh()} refreshing={browse.refreshing} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <ListingCard
              favoritePending={favorites.isPending(item.id)}
              listing={item}
              onPress={() => router.push({
                pathname: '/listings/[id]',
                params: {
                  id: item.id,
                  ...(item.distanceMiles != null ? { distanceMiles: String(item.distanceMiles) } : {}),
                },
              })}
              onSellerPress={() => router.push({
                pathname: '/sellers/[id]', params: { id: item.seller.id },
              })}
              onToggleSaved={() => favorites.toggleSaved(item.id)}
              saved={favorites.isSaved(item.id)}
            />
          </View>
        )}
        showsVerticalScrollIndicator={false}
        windowSize={7}
      />
    </SafeAreaView>
  );
}

function Empty({ action, body, icon, onPress, title }: {
  action?: string; body: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; title: string;
}) {
  return (
    <View style={styles.center}>
      <Ionicons color={colors.textSecondary} name={icon} size={34} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action ? <Pressable onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{action}</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, paddingBottom: spacing.xxl },
  grow: { flexGrow: 1 },
  header: { backgroundColor: colors.surface, marginBottom: spacing.md, padding: spacing.xl, paddingTop: spacing.xs },
  title: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.display, marginBottom: spacing.md },
  sorts: { gap: spacing.sm, paddingTop: spacing.md },
  summary: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.md },
  summaryText: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote },
  clear: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.footnote },
  locationHint: { alignItems: 'center', backgroundColor: colors.background, borderRadius: 10, flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between', marginTop: spacing.md, padding: spacing.sm },
  locationHintText: { color: colors.textSecondary, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.footnote },
  locationAction: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.footnote },
  row: { paddingHorizontal: spacing.sm },
  item: { flex: 1, marginBottom: spacing.md, marginHorizontal: spacing.sm, maxWidth: '50%' },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl },
  emptyTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.md },
  body: { color: colors.textSecondary, fontFamily: fontFamily.regular, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: 12, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  buttonText: { color: colors.white, fontFamily: fontFamily.bold },
  footer: { padding: spacing.xl },
});

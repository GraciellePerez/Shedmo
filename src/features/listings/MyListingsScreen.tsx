import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ManagedListingCard } from '@/features/profile/components/ManagedListingCard';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import type { ListingStatus } from '@/features/profile/types/profile';
import { useListingStore } from '@/features/listings/store/ListingStore';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

const tabs: { label: string; value: ListingStatus }[] = [
  { label: 'Active', value: 'active' },
  { label: 'Pending', value: 'pending_local_confirmation' },
  { label: 'Sold', value: 'sold' },
  { label: 'Drafts', value: 'draft' },
  { label: 'Expired', value: 'expired' },
  { label: 'Archived', value: 'archived' },
];

export function MyListingsScreen() {
  const router = useRouter();
  const { deleteListing, managedListings, setListingStatus } = useListingStore();
  const [tab, setTab] = useState<ListingStatus>('active');
  const items = useMemo(() => managedListings.filter((item) => item.status === tab), [managedListings, tab]);

  const confirmDelete = (id: string, title: string) => Alert.alert(
    'Delete listing?',
    `"${title}" and its stored photos will be permanently removed.`,
    [
      { style: 'cancel', text: 'Cancel' },
      { style: 'destructive', text: 'Delete', onPress: () => void deleteListing(id).catch(() => Alert.alert('Delete failed', 'Try again.')) },
    ],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader
        right={
          <Pressable accessibilityLabel="Create listing" onPress={() => router.navigate('/(tabs)/sell')}>
            <Ionicons color={colors.primary} name="add" size={27} />
          </Pressable>
        }
        title="My Listings"
      />
      <View style={styles.tabs}>
        {tabs.map((item) => (
          <Pressable key={item.value} onPress={() => setTab(item.value)} style={[styles.tab, tab === item.value && styles.activeTab]}>
            <Text style={[styles.tabText, tab === item.value && styles.activeTabText]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        contentContainerStyle={[styles.content, !items.length && styles.emptyContent]}
        data={items}
        keyExtractor={(item) => item.listing.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons color={colors.textSecondary} name={tab === 'draft' ? 'document-text-outline' : 'file-tray-outline'} size={34} />
            </View>
            <Text style={styles.emptyTitle}>No {tab} listings</Text>
            <Text style={styles.emptyBody}>Items with this status will appear here.</Text>
            <Pressable onPress={() => router.navigate('/(tabs)/sell')} style={styles.createButton}>
              <Text style={styles.createButtonText}>Create a Listing</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <ManagedListingCard
            item={item}
            onDelete={() => confirmDelete(item.listing.id, item.listing.title)}
            onEdit={() => router.push({ pathname: '/edit-listing/[id]', params: { id: item.listing.id } })}
            onOpen={() => router.push({ pathname: '/listings/[id]', params: { id: item.listing.id } })}
            onSold={() => router.push({ pathname: '/local-sale/[listingId]', params: { listingId: item.listing.id } })}
            onArchive={() => Alert.alert('Archive listing?', 'This removes the listing from the public marketplace.', [
              { style: 'cancel', text: 'Cancel' },
              { text: 'Archive', onPress: () => void setListingStatus(item.listing.id, 'archived').catch(() => Alert.alert('Update failed', 'Try again.')) },
            ])}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  tabs: { backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  tab: { alignItems: 'center', borderBottomColor: 'transparent', borderBottomWidth: 2, flex: 1, justifyContent: 'center', minHeight: 46 },
  activeTab: { borderBottomColor: colors.primary },
  tabText: { color: colors.textSecondary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  activeTabText: { color: colors.primary },
  content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxxl },
  emptyContent: { justifyContent: 'center' },
  empty: { alignItems: 'center', padding: spacing.xxl },
  emptyIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 34, height: 68, justifyContent: 'center', width: 68 },
  emptyTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.lg, textTransform: 'capitalize' },
  emptyBody: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, marginTop: spacing.sm },
  createButton: { backgroundColor: colors.primary, borderRadius: 13, marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  createButtonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.bodySmall },
});

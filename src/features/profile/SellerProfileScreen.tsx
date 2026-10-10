import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListingCard } from '@/components/ListingCard';
import { sellers } from '@/data';
import { useListingStore } from '@/features/listings/store/ListingStore';
import { useMessagingStore } from '@/features/messaging/store/MessagingStore';
import { ProfileHero } from '@/features/profile/components/ProfileHero';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { useFavoritesStore } from '@/features/favorites/store/FavoritesStore';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function SellerProfileScreen({ sellerId }: { sellerId: string }) {
  const router = useRouter();
  const { listings } = useListingStore();
  const { getOrCreateConversation } = useMessagingStore();
  const { isPending, isSaved, toggleSaved } = useFavoritesStore();
  const seller = sellers[sellerId];
  const sellerListings = listings.filter((listing) => listing.seller.id === sellerId);

  if (!seller) {
    return (
      <SafeAreaView style={styles.missing}>
        <Text style={styles.missingTitle}>Seller not found</Text>
        <Pressable onPress={() => router.back()}><Text style={styles.backText}>Go Back</Text></Pressable>
      </SafeAreaView>
    );
  }

  const messageSeller = async () => {
    const listing = sellerListings[0];
    if (!listing) {
      Alert.alert('No active listing', 'This seller has no active listing to start a conversation from.');
      return;
    }
    const result = await getOrCreateConversation(listing);
    if (result.id) router.push({ pathname: '/conversations/[id]', params: { id: result.id } });
    else Alert.alert('Conversation unavailable', result.error ?? 'Try again.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="" />
      <FlatList
        columnWrapperStyle={sellerListings.length ? styles.gridRow : undefined}
        contentContainerStyle={styles.content}
        data={sellerListings}
        keyExtractor={(listing) => listing.id}
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
            <View style={styles.hero}>
              <ProfileHero
                initials={seller.avatar}
                name={seller.name}
                rating={seller.rating}
                reviews={seller.reviews}
                subtitle={`${seller.location} · Member since ${seller.joined}`}
                verified={seller.verified}
              />
              <View style={styles.stats}>
                <Stat label="Items Sold" value={seller.sales} />
                <Divider />
                <Stat label="Reviews" value={seller.reviews} />
                <Divider />
                <Stat label="Response" value={seller.responseTime} />
              </View>
              <Pressable onPress={() => void messageSeller()} style={styles.messageButton}>
                <Ionicons color={colors.white} name="chatbubble-outline" size={18} />
                <Text style={styles.messageButtonText}>Message Seller</Text>
              </Pressable>
              <Pressable onPress={() => router.push({ pathname: '/reviews/[sellerId]', params: { sellerId } })} style={styles.reviewsButton}>
                <Ionicons color={colors.text} name="star-outline" size={17} />
                <Text style={styles.reviewsButtonText}>View {seller.reviews} Reviews</Text>
              </Pressable>
            </View>
            <View style={styles.listingsHeader}>
              <Text style={styles.listingsTitle}>Active Listings</Text>
              <Text style={styles.listingsCount}>{sellerListings.length}</Text>
            </View>
          </>
        }
        ListEmptyComponent={<Text style={styles.empty}>This seller has no active listings.</Text>}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text numberOfLines={1} style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, flexGrow: 1, paddingBottom: spacing.xxxl },
  hero: { backgroundColor: colors.surface, padding: spacing.xl },
  stats: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.lg, flexDirection: 'row', marginTop: spacing.lg, paddingVertical: spacing.md },
  stat: { alignItems: 'center', flex: 1, minWidth: 0 },
  statValue: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.subtitle },
  statLabel: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: spacing.xxs },
  divider: { backgroundColor: colors.border, height: 28, width: StyleSheet.hairlineWidth },
  messageButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.lg, minHeight: 50 },
  messageButtonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  reviewsButton: { alignItems: 'center', borderColor: colors.border, borderRadius: 14, borderWidth: 1.5, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.sm, minHeight: 48 },
  reviewsButtonText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  listingsHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, paddingTop: spacing.xxl },
  listingsTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle },
  listingsCount: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall },
  gridRow: { paddingHorizontal: spacing.sm },
  gridItem: { flex: 1, marginBottom: spacing.md, marginHorizontal: spacing.sm, maxWidth: '50%' },
  empty: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, padding: spacing.xl, textAlign: 'center' },
  missing: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' },
  missingTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title },
  backText: { color: colors.primary, fontFamily: fontFamily.semibold, marginTop: spacing.lg },
});

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import { useListingStore } from '@/features/listings/store/ListingStore';
import {
  cancelLocalSale, fetchEligibleLocalBuyers, fetchLocalSales, markLocalListingDisposition,
  respondLocalSale, startLocalSale, type EligibleBuyer, type LocalSale,
} from '@/features/localSales/localSaleRepository';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import type { Listing } from '@/models';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function LocalSaleScreen({ listingId }: { listingId: string }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const { getListingById, refreshListingById, refreshMyListings } = useListingStore();
  const [listing, setListing] = useState<Listing | null>(null);
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [buyers, setBuyers] = useState<EligibleBuyer[]>([]);
  const [choosingBuyer, setChoosingBuyer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, currentListing] = await Promise.all([fetchLocalSales(listingId), getListingById(listingId).catch(() => null)]);
      setSales(rows);
      setListing(currentListing);
      const isSeller = currentListing?.seller.id === user?.id;
      setBuyers(isSeller && !rows.some((row) => row.status === 'pending_buyer_confirmation')
        ? await fetchEligibleLocalBuyers(listingId).catch(() => []) : []);
    } catch {
      Alert.alert('Local sale unavailable', 'This transaction could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [getListingById, listingId, user?.id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      await Promise.all([
        refreshListingById(listingId).catch(() => null),
        refreshMyListings().catch(() => undefined),
      ]);
      await load();
    } catch {
      Alert.alert('Request not completed', 'The listing or confirmation may have changed. Refresh and try again.');
    } finally {
      setBusy(false);
    }
  };

  const markDisposition = (disposition: 'sold_elsewhere' | 'unavailable') => {
    const soldElsewhere = disposition === 'sold_elsewhere';
    Alert.alert(
      soldElsewhere ? 'Sold somewhere else?' : 'Remove this listing?',
      soldElsewhere
        ? 'The listing will be marked sold without creating a confirmed Shedmo sale.'
        : 'The listing will be archived and will not count as a sale.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: soldElsewhere ? 'Mark Sold' : 'Archive', onPress: () => void run(() => markLocalListingDisposition(listingId, disposition)) },
      ],
    );
  };

  const pending = sales.find((row) => row.status === 'pending_buyer_confirmation');
  const confirmed = sales.find((row) => row.status === 'confirmed');
  const rejected = sales.find((row) => row.status === 'rejected');
  const isSeller = listing?.seller.id === user?.id || pending?.sellerId === user?.id;
  const title = pending?.title ?? confirmed?.title ?? rejected?.title ?? listing?.title ?? 'this listing';

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Local Sale" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.notice}>
          <Text style={styles.heading}>Payment happens outside Shedmo</Text>
          <Text style={styles.body}>Arrange payment and pickup directly. Shedmo does not process or verify payment for local sales.</Text>
        </View>
        {loading ? <ActivityIndicator color={colors.primary} /> : confirmed ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Sale confirmed</Text>
            <Text style={styles.body}>The buyer confirmed this purchase. It counts as a completed Shedmo sale and reviews are available.</Text>
            <Pressable onPress={() => router.push({ pathname: '/leave-local-review/[confirmationId]', params: { confirmationId: confirmed.id } })} style={styles.primary}>
              <Text style={styles.primaryText}>Leave a Review</Text>
            </Pressable>
          </View>
        ) : pending && pending.buyerId === user?.id ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Confirm purchase</Text>
            <Text style={styles.body}>Did you purchase {title} from {pending.sellerName}?</Text>
            <Text style={styles.body}>Confirming allows the transaction to count as a completed Shedmo sale and enables reviews. Shedmo does not process or verify payment.</Text>
            <Pressable disabled={busy} onPress={() => void run(() => respondLocalSale(pending.id, true))} style={styles.primary}><Text style={styles.primaryText}>Yes, I bought this</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void run(() => respondLocalSale(pending.id, false))} style={styles.secondary}><Text style={styles.secondaryText}>No, I didn&apos;t</Text></Pressable>
          </View>
        ) : pending && isSeller ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Sold</Text>
            <Text style={styles.subheading}>Waiting for buyer confirmation</Text>
            <Text style={styles.body}>We&apos;ll record this as a confirmed Shedmo sale if the buyer confirms.</Text>
            <Pressable disabled={busy} onPress={() => Alert.alert(
              'Relist this item?', 'This cancels the pending confirmation and returns the listing to the marketplace.',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Relist', onPress: () => void run(() => cancelLocalSale(pending.id)) }],
            )} style={styles.secondary}><Text style={styles.secondaryText}>Relist and Cancel Request</Text></Pressable>
          </View>
        ) : rejected ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Purchase not confirmed</Text>
            <Text style={styles.body}>The buyer declined this confirmation. The listing remains sold, and this does not count as a confirmed Shedmo sale or enable reviews.</Text>
          </View>
        ) : isSeller && listing?.status === 'active' && choosingBuyer ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Select the buyer</Text>
            <Text style={styles.body}>Only buyers who already messaged about this listing are eligible.</Text>
            {buyers.map((buyer) => (
              <Pressable disabled={busy} key={buyer.buyerId} onPress={() => Alert.alert(
                'Mark sold and request confirmation?', buyer.buyerName,
                [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: () => void run(() => startLocalSale(listingId, buyer.conversationId)) }],
              )} style={styles.buyer}>
                <Text style={styles.buyerName}>{buyer.buyerName}</Text><Text style={styles.body}>Shedmo conversation</Text>
              </Pressable>
            ))}
            {!buyers.length ? <Text style={styles.body}>No eligible buyers yet. A buyer must message about this listing before they can be selected.</Text> : null}
            <Pressable onPress={() => setChoosingBuyer(false)} style={styles.secondary}><Text style={styles.secondaryText}>Back to Options</Text></Pressable>
          </View>
        ) : isSeller && listing?.status === 'active' ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Mark this listing as sold?</Text>
            <Option title="Sold on Shedmo" body="Select a buyer who messaged about this listing. The listing becomes sold immediately while confirmation remains pending." onPress={() => setChoosingBuyer(true)} />
            <Option title="Sold somewhere else" body="Mark the listing sold without creating a confirmed Shedmo transaction." onPress={() => markDisposition('sold_elsewhere')} />
            <Option title="No longer available" body="Archive the listing without counting it as a sale." onPress={() => markDisposition('unavailable')} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.heading}>{listing?.status === 'archived' ? 'No longer available' : 'Sold'}</Text>
            <Text style={styles.body}>No buyer confirmation is pending for this listing.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Option({ body, onPress, title }: { body: string; onPress: () => void; title: string }) {
  return <Pressable onPress={onPress} style={styles.option}><Text style={styles.buyerName}>{title}</Text><Text style={styles.body}>{body}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.surface, flex: 1 }, content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg },
  notice: { backgroundColor: '#FFF6E5', borderRadius: radii.lg, marginBottom: spacing.md, padding: spacing.lg }, card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  heading: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle }, subheading: { color: colors.text, fontFamily: fontFamily.semibold, marginTop: spacing.sm },
  body: { color: colors.textSecondary, lineHeight: 20, marginTop: spacing.sm }, buyer: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, marginTop: spacing.md, padding: spacing.md },
  buyerName: { color: colors.text, fontFamily: fontFamily.bold }, option: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, marginTop: spacing.md, padding: spacing.md },
  primary: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, marginTop: spacing.lg, padding: spacing.md }, primaryText: { color: colors.white, fontFamily: fontFamily.bold },
  secondary: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, marginTop: spacing.md, padding: spacing.md }, secondaryText: { color: colors.text, fontFamily: fontFamily.bold },
});

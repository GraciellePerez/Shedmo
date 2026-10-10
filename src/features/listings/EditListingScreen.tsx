import { showContentSafetyAlert } from '@/features/safety/showContentSafetyAlert';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DraftField } from '@/features/sell/components/DraftField';
import {
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_DESCRIPTION_MIN_LENGTH,
  listingDescriptionLength,
} from '@/features/sell/types/listingDraft';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { useListingStore } from '@/features/listings/store/ListingStore';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function EditListingScreen({ listingId }: { listingId: string }) {
  const router = useRouter();
  const { getListingById, managedListings, updateListing } = useListingStore();
  const owned = managedListings.some((item) => item.listing.id === listingId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getListingById(listingId).then((listing) => {
      if (listing) {
        setTitle(listing.title);
        setDescription(listing.description);
        setPrice(`${listing.price}`);
      }
    }).finally(() => setLoading(false));
  }, [getListingById, listingId]);

  const save = async () => {
    const numericPrice = Number(price);
    if (!title.trim() || title.trim().length > 120) {
      Alert.alert('Check title', 'Enter a title between 3 and 120 characters.');
      return;
    }
    const descriptionLength = listingDescriptionLength(description);
    if (
      descriptionLength < LISTING_DESCRIPTION_MIN_LENGTH
      || descriptionLength > LISTING_DESCRIPTION_MAX_LENGTH
    ) {
      Alert.alert(
        'Check description',
        `Enter a description between ${LISTING_DESCRIPTION_MIN_LENGTH} and ${LISTING_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters.`,
      );
      return;
    }
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      Alert.alert('Check price', 'Enter a valid price of $0 or more.');
      return;
    }
    setSaving(true);
    try {
      await updateListing(listingId, { title: title.trim(), description: description.trim(), price: numericPrice });
      Alert.alert('Listing updated', 'Your changes were saved.', [{ text: 'Done', onPress: () => router.back() }]);
    } catch (cause) {
      if (showContentSafetyAlert(cause)) return;
      Alert.alert('Update failed', 'The listing could not be updated. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Edit Listing" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {loading ? <Text style={styles.message}>Loading listing…</Text> : !owned ? (
            <Text style={styles.message}>Only the listing owner can edit this item.</Text>
          ) : (
            <View style={styles.card}>
              <DraftField label="Title" maxLength={120} onChangeText={setTitle} value={title} />
              <DraftField keyboardType="decimal-pad" label="Price" onChangeText={setPrice} value={price} />
              <DraftField label="Description" maxLength={LISTING_DESCRIPTION_MAX_LENGTH} multiline onChangeText={setDescription} value={description} />
              <Pressable disabled={saving} onPress={() => void save()} style={[styles.button, saving && styles.disabled]}>
                <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.surface, flex: 1 },
  flex: { flex: 1 },
  content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  message: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.body, textAlign: 'center' },
  button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, minHeight: 52, justifyContent: 'center' },
  buttonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  disabled: { opacity: 0.6 },
});

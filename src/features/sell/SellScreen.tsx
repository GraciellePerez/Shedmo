import { Ionicons } from '@expo/vector-icons';
import { ListingPhotoSafetyNotice } from '@/features/safety/ListingPhotoSafetyNotice';
import { showContentSafetyAlert } from '@/features/safety/showContentSafetyAlert';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConditionBadge } from '@/components/ConditionBadge';
import { useListingStore } from '@/features/listings/store/ListingStore';
import { useLocationStore } from '@/features/location/store/LocationStore';
import type { MarketplaceLocation } from '@/features/location/types/location';
import { StatePicker } from '@/features/location/components/StatePicker';
import { normalizeCity } from '@/features/location/locationValidation';
import { normalizeSelectedPhoto } from '@/features/sell/services/photoNormalizer';
import { ChoiceGrid } from '@/features/sell/components/ChoiceGrid';
import { DraftField } from '@/features/sell/components/DraftField';
import { PhotoGrid } from '@/features/sell/components/PhotoGrid';
import { SellProgress } from '@/features/sell/components/SellProgress';
import { useListingDraft } from '@/features/sell/hooks/useListingDraft';
import {
  sellCategories,
  sellConditions,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_TITLE_MAX_LENGTH,
  type SellStep,
} from '@/features/sell/types/listingDraft';
import { colors, fontFamily, fontSize, radii, shadows, spacing } from '@/theme';

const stepTitles: Record<SellStep, string> = {
  1: 'Add Photos',
  2: 'Item Details',
  3: 'Price & Location',
  4: 'Preview Listing',
};

export function SellScreen() {
  const router = useRouter();
  const { publishDraft } = useListingStore();
  const locationStore = useLocationStore();
  const form = useListingDraft();
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('');

  const applyLocation = useCallback((location: MarketplaceLocation) => {
    form.updateField('city', location.city);
    form.updateField('state', location.state);
    form.updateField('postalCode', location.postalCode);
    form.updateField('latitude', location.latitude);
    form.updateField('longitude', location.longitude);
    form.updateField('locationSource', location.source);
  }, [form]);

  const confirmLocationReplace = useCallback((action: () => Promise<MarketplaceLocation | null>) => {
    const run = () => void action().then((location) => {
      if (location) applyLocation(location);
    });
    if (form.draft.locationSource === 'manual' && (form.draft.city || form.draft.state)) {
      Alert.alert('Replace manual location?', 'This will replace the city and state you entered.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', onPress: run },
      ]);
    } else run();
  }, [applyLocation, form.draft.city, form.draft.locationSource, form.draft.state]);

  const confirmDiscard = useCallback((onDiscard?: () => void) => {
    if (!form.isDirty) {
      onDiscard?.();
      return;
    }
    Alert.alert(
      'Discard this listing?',
      'Your photos and listing details will be lost.',
      [
        { style: 'cancel', text: 'Keep Editing' },
        {
          style: 'destructive',
          text: 'Discard',
          onPress: () => {
            form.resetDraft();
            onDiscard?.();
          },
        },
      ],
    );
  }, [form]);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        if (publishedId) return false;
        if (form.step > 1) {
          form.previousStep();
          return true;
        }
        if (form.isDirty) {
          confirmDiscard();
          return true;
        }
        return false;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => subscription.remove();
    }, [confirmDiscard, form, publishedId]),
  );

  const pickPhotos = async () => {
    if (Platform.OS !== 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo Access Needed', 'Allow photo library access to add listing images.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ['images'],
      orderedSelection: true,
      quality: 0.9,
      selectionLimit: Math.max(1, 12 - form.draft.photos.length),
    });

    if (!result.canceled) {
      const existingUris = new Set(form.draft.photos.map((photo) => photo.uri));
      const accepted = result.assets.filter((asset) => !existingUris.has(asset.uri));
      try {
        const normalized = await Promise.all(accepted.map((asset, index) =>
          normalizeSelectedPhoto({
            id: `${asset.assetId ?? asset.uri}-${Date.now()}-${index}`,
            uri: asset.uri,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            mimeType: asset.mimeType,
            width: asset.width,
            height: asset.height,
          }, index)));
        form.addPhotos(normalized);
      } catch (cause) {
        Alert.alert(
          'Photo conversion failed',
          cause instanceof Error ? cause.message : 'One of the selected photos could not be prepared.',
        );
      }
    }
  };

  const save = async (status: 'active' | 'draft') => {
    if (submitting) return;
    setSubmitting(true);
    setUploadLabel(status === 'active' ? 'Preparing listing…' : 'Saving draft…');
    try {
      const listing = await publishDraft(form.draft, status, ({ completed, total }) => {
        setUploadLabel(`Uploading photo ${completed} of ${total}…`);
      });
      if (status === 'active') setPublishedId(listing.id);
      else {
        Alert.alert('Draft saved', 'Your draft and selected photos are saved securely.');
        form.resetDraft();
        router.push('/my-listings');
      }
    } catch (cause) {
      if (showContentSafetyAlert(cause)) return;
      Alert.alert(
        'Could not save listing',
        cause instanceof Error
          ? cause.message
          : 'Your listing was not published. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
      setUploadLabel('');
    }
  };

  const sellAnother = () => {
    form.resetDraft();
    setPublishedId(null);
  };

  if (publishedId) {
    return (
      <SafeAreaView style={styles.success}>
        <View style={styles.successIcon}>
          <Ionicons color={colors.white} name="checkmark" size={42} />
        </View>
        <Text style={styles.successTitle}>Listing Live!</Text>
        <Text style={styles.successBody}>
          Your item and photos were published securely and are now visible in the marketplace.
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: '/listings/[id]', params: { id: publishedId } })}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>View Listing</Text>
        </Pressable>
        <Pressable onPress={sellAnother} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Sell Another Item</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        style={styles.keyboardView}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.headerEyebrow}>SELL AN ITEM</Text>
            <Text style={styles.headerTitle}>{stepTitles[form.step]}</Text>
          </View>
          <Pressable onPress={() => confirmDiscard()} hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        <SellProgress step={form.step} />

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {form.step === 1 ? <ListingPhotoSafetyNotice /> : null}
          {form.step === 1 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Photos</Text>
              <Text style={styles.cardSubtitle}>Use clear photos from multiple angles.</Text>
              <PhotoGrid
                error={form.errors.photos}
                onAdd={pickPhotos}
                onMove={form.movePhoto}
                onRemove={form.removePhoto}
                photos={form.draft.photos}
              />
            </View>
          ) : null}

          {form.step === 2 ? (
            <>
              <View style={styles.card}>
                <DraftField
                  error={form.errors.title}
                  label="Title"
                  maxLength={LISTING_TITLE_MAX_LENGTH}
                  onChangeText={(value) => form.updateField('title', value)}
                  placeholder="e.g. Milwaukee M18 FUEL Drill Kit"
                  value={form.draft.title}
                />
                <ChoiceGrid
                  error={form.errors.category}
                  label="Category"
                  onChange={(value) => form.updateField('category', value)}
                  options={sellCategories}
                  value={form.draft.category}
                />
                <DraftField
                  error={form.errors.brand}
                  label="Brand"
                  onChangeText={(value) => form.updateField('brand', value)}
                  placeholder="e.g. Milwaukee, DeWalt"
                  value={form.draft.brand}
                />
                <ChoiceGrid
                  error={form.errors.condition}
                  label="Condition"
                  onChange={(value) => form.updateField('condition', value)}
                  options={sellConditions}
                  value={form.draft.condition}
                />
                <DraftField
                  error={form.errors.description}
                  label="Description"
                  maxLength={LISTING_DESCRIPTION_MAX_LENGTH}
                  multiline
                  onChangeText={(value) => form.updateField('description', value)}
                  placeholder="Describe condition notes, what is included, and anything buyers should know."
                  value={form.draft.description}
                />
                <DraftField
                  label="Model number"
                  onChangeText={(value) => form.updateField('modelNumber', value)}
                  optional
                  placeholder="e.g. 2803-22"
                  value={form.draft.modelNumber}
                />
                <DraftField
                  keyboardType="number-pad"
                  label="Year"
                  maxLength={4}
                  onChangeText={(value) => form.updateField('year', value.replace(/\D/g, ''))}
                  optional
                  placeholder="e.g. 2024"
                  value={form.draft.year}
                />
              </View>
            </>
          ) : null}

          {form.step === 3 ? (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Price</Text>
                <View style={[styles.priceInputWrap, form.errors.price && styles.errorBorder]}>
                  <Text style={styles.currency}>$</Text>
                  <DraftField
                    error={form.errors.price}
                    keyboardType="decimal-pad"
                    label=""
                    onChangeText={(value) => form.updateField('price', sanitizeMoney(value))}
                    placeholder="0"
                    style={styles.priceInput}
                    value={form.draft.price}
                  />
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Item Location</Text>
                <Text style={styles.cardSubtitle}>
                  Buyers see only city, state, and an approximate distance.
                </Text>
                <View style={styles.locationActions}>
                  <Pressable
                    disabled={locationStore.loading}
                    onPress={() => Alert.alert(
                      'Use current location?',
                      'We use foreground location once to estimate distance. Exact coordinates are not shown.',
                      [
                        { text: 'Not Now', style: 'cancel' },
                        {
                          text: 'Continue',
                          onPress: () => confirmLocationReplace(locationStore.useCurrentLocation),
                        },
                      ],
                    )}
                    style={styles.locationButton}
                  >
                    <Ionicons color={colors.primary} name="navigate-outline" size={18} />
                    <Text style={styles.locationButtonText}>Current</Text>
                  </Pressable>
                  <Pressable
                    disabled={locationStore.loading}
                    onPress={() => confirmLocationReplace(locationStore.useProfileLocation)}
                    style={styles.locationButton}
                  >
                    <Ionicons color={colors.primary} name="person-outline" size={18} />
                    <Text style={styles.locationButtonText}>Profile</Text>
                  </Pressable>
                </View>
                {locationStore.error ? <Text style={styles.error}>{locationStore.error}</Text> : null}
                <DraftField
                  autoCapitalize="characters"
                  error={form.errors.postalCode}
                  maxLength={10}
                  keyboardType="number-pad"
                  label="ZIP code"
                  onChangeText={(value) => {
                    form.updateField('postalCode', value.replace(/[^\d-]/g, ''));
                    form.updateField('latitude', null);
                    form.updateField('longitude', null);
                    form.updateField('locationSource', 'manual');
                  }}
                  placeholder="78701"
                  value={form.draft.postalCode}
                />
                {form.draft.locationSource === 'manual'
                  && form.draft.latitude != null
                  && form.draft.longitude != null ? (
                    <View style={styles.verifiedLocation}>
                      <View>
                        <Text style={styles.verifiedLabel}>Verified location</Text>
                        <Text style={styles.verifiedValue}>{form.draft.city}, {form.draft.state}</Text>
                      </View>
                      <Pressable onPress={() => {
                        form.updateField('city', '');
                        form.updateField('state', '');
                        form.updateField('latitude', null);
                        form.updateField('longitude', null);
                      }}>
                        <Text style={styles.locationButtonText}>Edit ZIP</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <>
                    <Pressable
                      disabled={locationStore.loading}
                      onPress={() => void locationStore.usePostalLocation(form.draft.postalCode)
                        .then((verified) => { if (verified) applyLocation(verified); })}
                      style={styles.verifyButton}
                    >
                      <Text style={styles.verifyButtonText}>
                        {locationStore.loading ? 'Verifying…' : 'Verify ZIP'}
                      </Text>
                    </Pressable>
                    <Text style={styles.fallbackLabel}>Or enter a city and select a state</Text>
                    <View style={styles.locationRow}>
                  <View style={styles.cityField}>
                    <DraftField
                      autoCapitalize="words"
                      error={form.errors.city}
                      label="City"
                      onEndEditing={() => form.updateField('city', normalizeCity(form.draft.city))}
                      onChangeText={(value) => {
                        form.updateField('city', value);
                        form.updateField('latitude', null);
                        form.updateField('longitude', null);
                        form.updateField('locationSource', 'manual');
                      }}
                      placeholder="Austin"
                      value={form.draft.city}
                    />
                  </View>
                  <View style={styles.stateField}>
                    <Text style={styles.pickerLabel}>State</Text>
                    <StatePicker
                      error={form.errors.state}
                      onChange={(value) => {
                        form.updateField('state', value);
                        form.updateField('latitude', null);
                        form.updateField('longitude', null);
                        form.updateField('locationSource', 'manual');
                      }}
                      value={form.draft.state}
                    />
                  </View>
                    </View>
                    </>
                  )}
              </View>
            </>
          ) : null}

          {form.step === 4 ? (
            <PreviewStep
              draft={form.draft}
              onEdit={form.goToStep}
            />
          ) : null}

          <View style={styles.actions}>
            {form.step > 1 ? (
              <Pressable onPress={form.previousStep} style={styles.backButton}>
                <Text style={styles.backButtonText}>Back</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={submitting}
              onPress={form.step === 4 ? () => void save('active') : form.nextStep}
              style={[styles.continueButton, submitting && { opacity: 0.6 }]}
            >
              <Text style={styles.continueButtonText}>
                {submitting ? uploadLabel : form.step === 4 ? 'Publish Listing' : 'Continue'}
              </Text>
            </Pressable>
          </View>
          {form.step === 4 ? (
            <Pressable disabled={submitting} onPress={() => void save('draft')} style={styles.textButton}>
              <Text style={styles.textButtonLabel}>Save as Draft</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PreviewStep({
  draft,
  onEdit,
}: {
  draft: ReturnType<typeof useListingDraft>['draft'];
  onEdit: (step: SellStep) => void;
}) {
  return (
    <>
      <View style={styles.previewCard}>
        <Image contentFit="cover" source={draft.photos[0].uri} style={styles.previewImage} />
        <View style={styles.previewBody}>
          <View style={styles.previewPriceRow}>
            <Text style={styles.previewPrice}>${Number(draft.price).toLocaleString()}</Text>
            <ConditionBadge condition={draft.condition || 'Good'} />
          </View>
          <Text style={styles.previewTitle}>{draft.title}</Text>
          <View style={styles.previewMeta}>
            <Ionicons color={colors.textSecondary} name="grid-outline" size={14} />
            <Text style={styles.previewMetaText}>{draft.category}</Text>
          </View>
          <View style={styles.previewMeta}>
            <Ionicons color={colors.textSecondary} name="location-outline" size={14} />
            <Text style={styles.previewMetaText}>{draft.city}, {draft.state.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <PreviewSection label="Photos" onEdit={() => onEdit(1)}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.previewPhotos}>
            {draft.photos.map((photo) => (
              <Image key={photo.id} contentFit="cover" source={photo.uri} style={styles.previewThumb} />
            ))}
          </View>
        </ScrollView>
      </PreviewSection>

      <PreviewSection label="Item Details" onEdit={() => onEdit(2)}>
        <PreviewRow label="Brand" value={draft.brand} />
        <PreviewRow label="Category" value={draft.category} />
        <PreviewRow label="Condition" value={draft.condition} />
        {draft.modelNumber ? <PreviewRow label="Model" value={draft.modelNumber} /> : null}
        {draft.year ? <PreviewRow label="Year" value={draft.year} /> : null}
        <Text style={styles.previewDescription}>{draft.description}</Text>
      </PreviewSection>

      <PreviewSection label="Price & Location" onEdit={() => onEdit(3)}>
        <PreviewRow label="Price" value={`$${draft.price}`} />
        <PreviewRow label="Location" value={`${draft.city}, ${draft.state.toUpperCase()}`} />
      </PreviewSection>

      <View style={styles.prototypeNote}>
        <Ionicons color={colors.textSecondary} name="information-circle-outline" size={18} />
        <Text style={styles.prototypeNoteText}>
          Publishing makes this listing and its photos visible in the local marketplace.
        </Text>
      </View>
    </>
  );
}

function PreviewSection({
  children,
  label,
  onEdit,
}: {
  children: React.ReactNode;
  label: string;
  onEdit: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.previewSectionHeader}>
        <Text style={styles.cardTitle}>{label}</Text>
        <Pressable hitSlop={8} onPress={onEdit}>
          <Text style={styles.edit}>Edit</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewRowLabel}>{label}</Text>
      <Text style={styles.previewRowValue}>{value}</Text>
    </View>
  );
}

function sanitizeMoney(value: string) {
  const sanitized = value.replace(/[^0-9.]/g, '');
  const [whole, ...decimals] = sanitized.split('.');
  return decimals.length ? `${whole}.${decimals.join('').slice(0, 2)}` : whole;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  keyboardView: { flex: 1 },
  header: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.xs },
  headerEyebrow: { color: colors.primary, fontFamily: fontFamily.bold, fontSize: fontSize.caption, letterSpacing: 0.7 },
  headerTitle: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 22, marginTop: spacing.xxs },
  cancel: { color: colors.textSecondary, fontFamily: fontFamily.semibold, fontSize: 14 },
  content: { backgroundColor: colors.background, padding: spacing.lg, paddingBottom: 120 },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.md, padding: spacing.lg, ...shadows.card },
  cardTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body, marginBottom: spacing.sm },
  cardSubtitle: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, lineHeight: 18, marginBottom: spacing.md },
  priceInputWrap: { alignItems: 'center', backgroundColor: colors.background, borderColor: 'transparent', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', paddingHorizontal: spacing.lg },
  errorBorder: { borderColor: colors.primary },
  currency: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 26, marginRight: spacing.xs },
  priceInput: { backgroundColor: 'transparent', borderWidth: 0, fontFamily: fontFamily.extraBold, fontSize: 26, paddingHorizontal: 0 },
  error: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, marginTop: spacing.sm },
  locationRow: { flexDirection: 'row', gap: spacing.md },
  cityField: { flex: 2 },
  stateField: { flex: 1 },
  locationActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  locationButton: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  locationButtonText: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  pickerLabel: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall, marginBottom: 6 },
  verifyButton: { alignItems: 'center', backgroundColor: colors.text, borderRadius: radii.md, marginBottom: spacing.md, padding: spacing.md },
  verifyButtonText: { color: colors.white, fontFamily: fontFamily.bold },
  verifiedLocation: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.md, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  verifiedLabel: { color: colors.success, fontFamily: fontFamily.bold, fontSize: fontSize.footnote },
  verifiedValue: { color: colors.text, fontFamily: fontFamily.semibold, marginTop: spacing.xxs },
  fallbackLabel: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  backButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1.5, flex: 1, justifyContent: 'center', minHeight: 52 },
  backButtonText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.body },
  continueButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14, flex: 2, justifyContent: 'center', minHeight: 52 },
  continueButtonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  previewCard: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.md, overflow: 'hidden', ...shadows.card },
  previewImage: { aspectRatio: 1.45, width: '100%' },
  previewBody: { padding: spacing.lg },
  previewPriceRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  previewPrice: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 24 },
  previewTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 23, marginBottom: spacing.sm, marginTop: spacing.xs },
  previewMeta: { alignItems: 'center', flexDirection: 'row', marginTop: 6 },
  previewMetaText: { color: colors.textSecondary, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, marginLeft: spacing.sm },
  previewSectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  edit: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  previewPhotos: { flexDirection: 'row', gap: spacing.sm },
  previewThumb: { borderRadius: radii.sm, height: 72, width: 72 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 30 },
  previewRowLabel: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall },
  previewRowValue: { color: colors.text, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, maxWidth: '60%', textAlign: 'right' },
  previewDescription: { color: colors.text, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 20, marginTop: spacing.sm },
  prototypeNote: { alignItems: 'flex-start', backgroundColor: '#FFF8E7', borderRadius: radii.md, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  prototypeNoteText: { color: colors.textSecondary, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, lineHeight: 17 },
  success: { alignItems: 'center', backgroundColor: colors.surface, flex: 1, justifyContent: 'center', padding: spacing.xxxl },
  successIcon: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 42, height: 84, justifyContent: 'center', marginBottom: spacing.xl, width: 84 },
  successTitle: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 27 },
  successBody: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 23, marginBottom: spacing.xxl, marginTop: spacing.sm, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14, minHeight: 52, justifyContent: 'center', width: '100%' },
  primaryButtonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  textButton: { marginTop: spacing.lg, padding: spacing.sm },
  textButtonLabel: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: 14 },
});

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { ConditionBadge } from '@/components/ConditionBadge';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { useListingStore } from '@/features/listings/store/ListingStore';
import { useMessagingStore } from '@/features/messaging/store/MessagingStore';
import { useFavoritesStore } from '@/features/favorites/store/FavoritesStore';
import { colors, fontFamily, fontSize, radii, shadows, spacing } from '@/theme';
import type { Listing } from '@/models';
import { useLocationStore } from '@/features/location/store/LocationStore';
import { fetchListingDistance } from '@/features/listings/services/listingRepository';
import { formatDistanceMiles } from '@/features/location/formatDistance';
import { formatListingCategory } from '@/features/listings/categoryLabels';
import { ReportModal } from '@/features/reports/components/ReportModal';
import { isListingCheckoutEligible } from '@/features/checkout/sellerEligibility';
import { recordRecentlyViewed } from '@/features/recent/recentlyViewedRepository';
import { ListingGalleryModal } from '@/features/listings/components/ListingGalleryModal';
import { telemetry } from '@/services/telemetry';
import {
  getProductDetailsActionState,
  isLatestListingRequest,
} from '@/features/listings/productDetailsActionState';
import { listingGalleryHeight } from '@/features/listings/galleryLayout';
import { PUBLIC_SHIPPING_ENABLED } from '@/config/launchFeatures';

export function ProductDetailsScreen({
  initialDistanceMiles,
  listingId,
}: {
  initialDistanceMiles?: number | null;
  listingId: string;
}) {
  const router = useRouter();
  const { user } = useAuthStore();
  const { refreshListingById } = useListingStore();
  const { getOrCreateConversation } = useMessagingStore();
  const { isPending, isSaved, toggleSaved } = useFavoritesStore();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const { location: marketplaceLocation } = useLocationStore();
  const marketplaceLatitude = marketplaceLocation?.latitude ?? null;
  const marketplaceLongitude = marketplaceLocation?.longitude ?? null;
  const [listing, setListing] = useState<Listing | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [openingConversation, setOpeningConversation] = useState(false);

  useEffect(() => {
    setActiveImage(0);
    setFailedImages({});
  }, [listingId]);
  const [reportVisible, setReportVisible] = useState(false);
  const [sellerCheckoutEligible, setSellerCheckoutEligible] = useState<boolean | null>(null);
  const galleryRef = useRef<FlatList<string>>(null);
  const listingRef = useRef<Listing | null>(null);
  const listingRequestRef = useRef(0);
  const eligibilityRequestRef = useRef(0);
  const currentUserId = user?.id ?? null;
  const listingSellerId = listing?.seller.id ?? null;
  const isOwner = Boolean(currentUserId && listingSellerId === currentUserId);
  const canReportListing = Boolean(
    currentUserId
    && listingSellerId
    && listingSellerId !== currentUserId
  );
  const listingStatus = listing?.status ?? 'active';
  const actionState = getProductDetailsActionState({
    hasPickup: Boolean(listing?.pickup),
    hasShipping: Boolean(listing?.shipping),
    isOwner,
    offerSupported: Boolean(listing?.offerOk),
    publicShippingEnabled: PUBLIC_SHIPPING_ENABLED,
    sellerCheckoutEligible,
    status: listingStatus,
  });

  useEffect(() => {
    if (currentUserId && listing?.id === listingId) {
      void recordRecentlyViewed(listingId);
      telemetry.track('listing_viewed', 'listing', listingId, { category: listing.category });
    }
  }, [currentUserId, listing?.category, listing?.id, listingId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    const requestId = ++listingRequestRef.current;
    if (!listingRef.current) setDetailLoading(true);
    setDetailError(null);
    void refreshListingById(listingId)
      .then((next) => {
        if (!next || !active || !isLatestListingRequest(requestId, listingRequestRef.current)) return;
        const canResolveDistance = marketplaceLatitude != null && marketplaceLongitude != null;
        const immediateDistance = canResolveDistance ? initialDistanceMiles ?? null : null;
        const resolvedListing = {
          ...next,
          distanceMiles: immediateDistance,
          distance: formatDistanceMiles(immediateDistance),
        };
        listingRef.current = resolvedListing;
        setListing(resolvedListing);
        if (canResolveDistance) {
          void fetchListingDistance(listingId, marketplaceLatitude, marketplaceLongitude)
            .then((resolvedDistance) => {
              if (active && isLatestListingRequest(requestId, listingRequestRef.current)) {
                setListing((current) => {
                  const updated = current ? {
                    ...current,
                    distanceMiles: resolvedDistance,
                    distance: formatDistanceMiles(resolvedDistance),
                  } : current;
                  listingRef.current = updated;
                  return updated;
                });
              }
            })
            .catch(() => {
              // Listing details remain usable when distance lookup is unavailable.
            });
        }
      })
      .catch(() => {
        if (active && isLatestListingRequest(requestId, listingRequestRef.current)) {
          setDetailError('This listing could not be loaded. Check your connection and retry.');
        }
      })
      .finally(() => {
        if (active && isLatestListingRequest(requestId, listingRequestRef.current)) {
          setDetailLoading(false);
        }
      });
    return () => {
      active = false;
      listingRequestRef.current += 1;
    };
  }, [
    initialDistanceMiles, listingId, marketplaceLatitude, marketplaceLongitude, refreshListingById,
  ]));

  useEffect(() => {
    const requestId = ++eligibilityRequestRef.current;
    if (!listingSellerId || !actionState.evaluateSellerEligibility) {
      setSellerCheckoutEligible(null);
      return;
    }
    let active = true;
    setSellerCheckoutEligible(null);
    void isListingCheckoutEligible(listingId)
      .then((eligible) => {
        if (active && requestId === eligibilityRequestRef.current) {
          setSellerCheckoutEligible(eligible);
        }
      })
      .catch(() => {
        if (active && requestId === eligibilityRequestRef.current) {
          setSellerCheckoutEligible(false);
        }
      });
    return () => { active = false; };
  }, [actionState.evaluateSellerEligibility, listingId, listingSellerId]);

  if (detailLoading || !listing) {
    return (
      <SafeAreaView style={styles.notFound}>
        <Ionicons color={colors.textSecondary} name={detailLoading ? 'hourglass-outline' : 'cube-outline'} size={42} />
        <Text style={styles.notFoundTitle}>{detailLoading ? 'Loading listing…' : detailError ?? 'Listing not found'}</Text>
        <Pressable onPress={() => router.back()} style={styles.notFoundButton}>
          <Text style={styles.notFoundButtonText}>Go Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const images = listing.images.length ? listing.images : [listing.image];
  const galleryHeight = listingGalleryHeight(width, height);

  const updateGalleryIndex = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    setActiveImage(Math.max(0, Math.min(index, images.length - 1)));
  };

  const shareListing = async () => {
    await Share.share({
      message: `${listing.title} — $${listing.price.toLocaleString()} on Shedmo`,
      title: listing.title,
    });
    telemetry.track('listing_shared', 'listing', listing.id);
  };

  const messageSeller = async () => {
    if (isOwner || openingConversation) return;
    setOpeningConversation(true);
    const result = await getOrCreateConversation(listing);
    setOpeningConversation(false);
    if (result.error || !result.id) {
      Alert.alert('Conversation unavailable', result.error ?? 'Try again.');
      return;
    }
    router.push({
      pathname: '/conversations/[id]',
      params: { id: result.id },
    });
  };

  const openSeller = () => router.push({
    pathname: '/sellers/[id]',
    params: { id: listing.seller.id },
  });

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 126 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.gallery, { height: galleryHeight }]}>
          <FlatList
            ref={galleryRef}
            data={images}
            decelerationRate="fast"
            horizontal
            keyExtractor={(item, index) => `${item}-${index}`}
            onMomentumScrollEnd={updateGalleryIndex}
            pagingEnabled
            renderItem={({ item, index }) => (
              <Pressable accessibilityLabel={`${listing.title}, image ${index + 1} of ${images.length}${item && !failedImages[index] ? '. Open full screen.' : ''}`} onPress={() => { if (!item || failedImages[index]) return; setActiveImage(index); setGalleryVisible(true); }}>
                <View style={[styles.galleryImageFrame, { height: galleryHeight, width }]}>
                  {item && !failedImages[index] ? <>
                    <Image blurRadius={24} cachePolicy="memory-disk" contentFit="cover" pointerEvents="none" source={item} style={styles.galleryBackdrop} />
                    <Image cachePolicy="memory-disk" contentFit="contain" onError={() => setFailedImages((current) => ({ ...current, [index]: true }))} recyclingKey={`${listing.id}:${index}`} source={item} style={styles.galleryImage} transition={180} />
                  </> : <View style={styles.galleryFallback}><Ionicons color={colors.textMuted} name="image-outline" size={48} /><Text style={styles.galleryFallbackText}>Photo unavailable</Text></View>}
                </View>
              </Pressable>
            )}
            showsHorizontalScrollIndicator={false}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'transparent']}
            pointerEvents="none"
            style={styles.galleryTopGradient}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.35)']}
            pointerEvents="none"
            style={styles.galleryBottomGradient}
          />

          <View style={[styles.galleryActions, { top: insets.top + spacing.sm }]}>
            <Pressable accessibilityLabel="Go back" onPress={() => router.back()} style={styles.roundAction}>
              <Ionicons color={colors.white} name="chevron-back" size={24} />
            </Pressable>
            <View style={styles.actionGroup}>
              <Pressable
                accessibilityLabel={isSaved(listing.id) ? 'Remove from favorites' : 'Save to favorites'}
                disabled={isPending(listing.id)}
                onPress={() => {
                  void toggleSaved(listing.id).then((result) => {
                    if (result.error) Alert.alert('Could not update Saved Items', result.error);
                  });
                }}
                style={[styles.roundAction, isPending(listing.id) && styles.favoritePending]}
              >
                <Ionicons
                  color={isSaved(listing.id) ? colors.primary : colors.white}
                  name={isSaved(listing.id) ? 'heart' : 'heart-outline'}
                  size={21}
                />
              </Pressable>
              <Pressable accessibilityLabel="Share listing" onPress={shareListing} style={styles.roundAction}>
                <Ionicons color={colors.white} name="share-outline" size={21} />
              </Pressable>
            </View>
          </View>

          <View style={styles.conditionPosition}>
            <ConditionBadge condition={listing.condition} />
          </View>
          {images.length > 1 ? <View style={styles.photoCount}>
            <Ionicons color={colors.white} name="images-outline" size={13} />
            <Text style={styles.photoCountText}>{activeImage + 1}/{images.length}</Text>
          </View> : null}
          {images.length > 1 ? (
            <View style={styles.dots}>
              {images.map((_, index) => (
                <Pressable
                  accessibilityLabel={`Show image ${index + 1}`}
                  key={index}
                  onPress={() => {
                    galleryRef.current?.scrollToIndex({ animated: true, index });
                    setActiveImage(index);
                  }}
                  style={[styles.dot, index === activeImage && styles.activeDot]}
                />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.primaryInfo}>
          <View style={styles.priceRow}>
            <Text style={styles.price}>${listing.price.toLocaleString()}</Text>
          </View>
          <View style={styles.activityRow}>
            <Ionicons color={colors.textSecondary} name="eye-outline" size={15} />
            <Text style={styles.activityText}>{listing.views} views</Text>
            <Text style={styles.activityDivider}>•</Text>
            <Text style={styles.activityText}>Listed {listing.timeAgo}</Text>
          </View>
          <Text style={styles.productTitle}>{listing.title}</Text>
          <View style={styles.categoryLine}>
            <Ionicons color={colors.textSecondary} name="grid-outline" size={14} />
            <Text style={styles.categoryText}>{formatListingCategory(listing.category)}</Text>
          </View>
        </View>

        {isOwner ? (
          <View style={styles.ownerControls}>
            <Text style={styles.ownerLabel}>YOUR LISTING</Text>
            <View style={styles.ownerActions}>
              <Pressable onPress={() => router.push({ pathname: '/edit-listing/[id]', params: { id: listingId } })} style={styles.ownerButton}>
                <Ionicons color={colors.primary} name="create-outline" size={17} />
                <Text style={styles.ownerButtonText}>Edit Listing</Text>
              </Pressable>
              {listingStatus === 'active' ? (
                <Pressable onPress={() => router.push({ pathname: '/local-sale/[listingId]', params: { listingId } })} style={styles.ownerButton}>
                  <Ionicons color={colors.primary} name="checkmark-circle-outline" size={17} />
                  <Text style={styles.ownerButtonText}>Mark as Sold</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <Divider />

        <Pressable onPress={openSeller} style={({ pressed }) => [styles.sellerRow, pressed && styles.pressed]}>
          <Avatar imageUri={listing.seller.avatarUrl} initials={listing.seller.avatar} size={46} />
          <View style={styles.sellerCopy}>
            <View style={styles.sellerNameRow}>
              <Text style={styles.sellerName}>{listing.seller.name}</Text>
              {listing.seller.verified ? (
                <Ionicons color={colors.info} name="checkmark-circle" size={16} />
              ) : null}
            </View>
            <View style={styles.ratingRow}>
              <Ionicons color={colors.warning} name="star" size={13} />
              <Text style={styles.rating}>{listing.seller.rating}</Text>
              <Text style={styles.sellerMeta}>
                ({listing.seller.reviews}) • {listing.seller.sales} sales
              </Text>
            </View>
          </View>
          <Ionicons color={colors.textMuted} name="chevron-forward" size={18} />
        </Pressable>

        {!isOwner ? <View style={styles.messageWrap}>
          {actionState.showLocalMessage ? <Pressable
            disabled={openingConversation}
            onPress={() => void messageSeller()}
            style={({ pressed }) => [styles.messageButton, pressed && styles.pressed, openingConversation && styles.favoritePending]}
          >
            <Ionicons color={colors.text} name="chatbubble-outline" size={18} />
            <Text style={styles.messageButtonText}>{openingConversation ? 'Opening…' : 'Message Seller'}</Text>
          </Pressable> : null}
          {canReportListing ? (
            <Pressable
              accessibilityLabel="Report listing"
              accessibilityRole="button"
              onPress={() => setReportVisible(true)}
              style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}
            >
              <Ionicons color={colors.primary} name="flag-outline" size={17} />
              <Text style={styles.reportButtonText}>Report listing</Text>
            </Pressable>
          ) : null}
        </View> : null}

        <Divider />

        <View style={styles.section}>
          <DetailRow
            icon="location-outline"
            text={`${listing.location}${listing.distance ? ` • ${listing.distance}` : ''}`}
          />
          {listing.pickup && PUBLIC_SHIPPING_ENABLED && listing.shipping ? (
            <DetailRow icon="navigate-outline" text="Local pickup — Arrange with seller and pay directly" />
          ) : null}
          {listing.pickup && PUBLIC_SHIPPING_ENABLED && listing.shipping ? (
            <DetailRow
              icon="car-outline"
              text="Shipping — Pay through Shedmo Protected Checkout"
            />
          ) : null}
          {listing.pickup && (!PUBLIC_SHIPPING_ENABLED || !listing.shipping) ? (
            <>
              <DetailRow icon="navigate-outline" text="Local pickup only" />
              <FulfillmentNote text="Message the seller to arrange a meetup and pay directly after inspecting the item." />
            </>
          ) : null}
          {PUBLIC_SHIPPING_ENABLED && !listing.pickup && listing.shipping ? (
            <>
              <DetailRow icon="car-outline" text={`Shipping available${listing.shippingCost === 0 ? ' — Free shipping' : ` — $${listing.shippingCost} shipping`}`} />
              <FulfillmentNote text="Shipped purchases use Shedmo Protected Checkout." />
            </>
          ) : null}
        </View>

        <Divider />

        <View style={styles.section}>
          <SectionTitle>Description</SectionTitle>
          <Text numberOfLines={expanded ? undefined : 4} style={styles.description}>
            {listing.description}
          </Text>
          <Pressable hitSlop={8} onPress={() => setExpanded((current) => !current)} style={styles.readMore}>
            <Text style={styles.readMoreText}>{expanded ? 'Show less' : 'Read more'}</Text>
          </Pressable>
        </View>

        <Divider />

        <View style={styles.section}>
          <SectionTitle>Specifications</SectionTitle>
          <SpecificationRow label="Brand" value={listing.brand} />
          <SpecificationRow label="Condition" value={listing.condition} />
          <SpecificationRow label="Category" value={formatListingCategory(listing.category)} />
          {PUBLIC_SHIPPING_ENABLED ? <SpecificationRow label="Shipping" value={listing.shipping ? 'Available' : 'Not available'} /> : null}
          <SpecificationRow label="Local pickup" value={listing.pickup ? 'Available' : 'Not available'} last />
        </View>

        <Divider />

        <View style={styles.section}>
          <SectionTitle>About the Seller</SectionTitle>
          <Pressable onPress={openSeller} style={({ pressed }) => [styles.sellerProfile, pressed && styles.pressed]}>
            <Avatar imageUri={listing.seller.avatarUrl} initials={listing.seller.avatar} size={54} />
            <View style={styles.sellerProfileCopy}>
              <View style={styles.sellerNameRow}>
                <Text style={styles.sellerName}>{listing.seller.name}</Text>
                {listing.seller.verified ? (
                  <Ionicons color={colors.info} name="checkmark-circle" size={16} />
                ) : null}
              </View>
              <Text style={styles.sellerMeta}>
                Member since {listing.seller.joined} • {listing.seller.location}
              </Text>
              <Text style={styles.sellerMeta}>Responds {listing.seller.responseTime}</Text>
            </View>
          </Pressable>
          <View style={styles.stats}>
            <SellerStat label="Rating" value={String(listing.seller.rating)} />
            <View style={styles.statDivider} />
            <SellerStat label="Reviews" value={String(listing.seller.reviews)} />
            <View style={styles.statDivider} />
            <SellerStat label="Sales" value={String(listing.seller.sales)} />
          </View>
        </View>
      </ScrollView>
      <ListingGalleryModal images={images} initialIndex={activeImage} onClose={() => setGalleryVisible(false)} title={listing.title} visible={galleryVisible} />

      {actionState.showBuyerActions ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {actionState.showLocalMessage ? (
          <Pressable
            onPress={() => void messageSeller()}
            style={({ pressed }) => [styles.offerButton, pressed && styles.pressed]}
          >
            <Text style={styles.offerButtonText}>Message Seller{`\n`}<Text style={styles.actionHint}>Arrange local pickup</Text></Text>
          </Pressable>
        ) : null}
        {actionState.showShippingCheckout ? <Pressable
          disabled={!actionState.checkoutEnabled}
          onPress={() => {
            if (!actionState.checkoutEnabled) return;
            telemetry.track('protected_checkout_selected', 'listing', listingId, { fulfillment_type: 'shipping' });
            router.push({ pathname: '/checkout/[listingId]', params: { listingId, fulfillment: 'shipping' } });
          }}
          style={({ pressed }) => [styles.buyButton, !actionState.checkoutEnabled && styles.buyButtonDisabled, pressed && actionState.checkoutEnabled && styles.pressed]}
        >
          <Text style={styles.buyButtonText}>{actionState.checkoutEnabled ? <>Buy Shipped{`\n`}<Text style={styles.buyActionHint}>Protected Checkout</Text></> : actionState.checkoutLabel}</Text>
        </Pressable>
        : null}
      </View> : null}
      <ReportModal
        onClose={() => setReportVisible(false)}
        target={{ type: 'listing', targetId: listing.id }}
        visible={reportVisible && canReportListing}
      />
    </View>
  );
}

function DetailRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons color={colors.textSecondary} name={icon} size={17} />
      <Text style={styles.detailRowText}>{text}</Text>
    </View>
  );
}

function FulfillmentNote({ text }: { text: string }) {
  return <Text style={styles.fulfillmentNote}>{text}</Text>;
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Divider() {
  return <View style={styles.divider} />;
}

function SpecificationRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.specificationRow, !last && styles.specificationDivider]}>
      <Text style={styles.specificationLabel}>{label}</Text>
      <Text style={styles.specificationValue}>{value}</Text>
    </View>
  );
}

function SellerStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.surface, flex: 1 },
  scrollContent: { backgroundColor: colors.surface },
  gallery: { backgroundColor: '#E8E8EA', overflow: 'hidden' },
  galleryImageFrame: { alignItems: 'center', backgroundColor: '#E8E8EA', justifyContent: 'center', overflow: 'hidden' },
  galleryBackdrop: { bottom: 0, left: 0, opacity: 0.2, position: 'absolute', right: 0, top: 0, transform: [{ scale: 1.08 }] },
  galleryImage: { height: '100%', width: '100%' },
  galleryFallback: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  galleryFallbackText: { color: colors.textSecondary, fontFamily: fontFamily.medium, marginTop: spacing.sm },
  galleryTopGradient: { height: 120, left: 0, position: 'absolute', right: 0, top: 0 },
  galleryBottomGradient: { bottom: 0, height: 80, left: 0, position: 'absolute', right: 0 },
  galleryActions: { flexDirection: 'row', justifyContent: 'space-between', left: spacing.lg, position: 'absolute', right: spacing.lg },
  actionGroup: { flexDirection: 'row', gap: spacing.sm },
  roundAction: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.46)', borderRadius: radii.round, height: 40, justifyContent: 'center', width: 40 },
  favoritePending: { opacity: 0.55 },
  conditionPosition: { bottom: 15, left: spacing.lg, position: 'absolute' },
  photoCount: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radii.round, flexDirection: 'row', gap: spacing.xs, paddingHorizontal: 10, paddingVertical: 5, position: 'absolute', right: spacing.lg, top: 76 },
  photoCountText: { color: colors.white, fontFamily: fontFamily.semibold, fontSize: fontSize.footnote },
  dots: { alignItems: 'center', bottom: 18, flexDirection: 'row', gap: 5, left: '40%', position: 'absolute' },
  dot: { backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 3, height: 6, width: 6 },
  activeDot: { backgroundColor: colors.white, width: 18 },
  primaryInfo: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  priceRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  price: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 28, letterSpacing: -0.5 },
  activityRow: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.sm },
  activityText: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginLeft: spacing.xs },
  activityDivider: { color: colors.border, marginHorizontal: spacing.sm },
  productTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, lineHeight: 27, marginTop: spacing.sm },
  categoryLine: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.sm },
  categoryText: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, marginLeft: spacing.xs },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginHorizontal: spacing.xl },
  ownerControls: { alignItems: 'center', backgroundColor: '#FFF6E5', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  ownerLabel: { color: colors.textSecondary, fontFamily: fontFamily.bold, fontSize: fontSize.caption },
  ownerActions: { alignItems: 'flex-end', gap: spacing.sm },
  ownerButton: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  ownerButtonText: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  sellerRow: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: spacing.xl, paddingTop: 14 },
  sellerCopy: { flex: 1, marginLeft: spacing.md },
  sellerNameRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  sellerName: { color: colors.text, fontFamily: fontFamily.bold, fontSize: 16 },
  ratingRow: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.xs },
  rating: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall, marginLeft: spacing.xs },
  sellerMeta: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 19, marginLeft: spacing.xs },
  messageWrap: { paddingBottom: 14, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  messageButton: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1.5, flexDirection: 'row', justifyContent: 'center', minHeight: 46 },
  messageButtonText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.body, marginLeft: spacing.sm },
  reportButton: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, minHeight: 40, paddingHorizontal: spacing.md },
  reportButtonText: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  section: { paddingHorizontal: spacing.xl, paddingVertical: 14 },
  sectionTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body, marginBottom: spacing.sm },
  detailRow: { alignItems: 'center', flexDirection: 'row', minHeight: 31 },
  detailRowText: { color: colors.text, flex: 1, fontFamily: fontFamily.regular, fontSize: 14, marginLeft: 10 },
  fulfillmentNote: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, lineHeight: 18, marginLeft: 27, marginTop: spacing.xs },
  description: { color: '#3A3A3C', fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 22 },
  readMore: { alignSelf: 'flex-start', marginTop: spacing.sm },
  readMoreText: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  specificationRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 39 },
  specificationDivider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  specificationLabel: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 14 },
  specificationValue: { color: colors.text, fontFamily: fontFamily.medium, fontSize: 14, maxWidth: '58%', textAlign: 'right' },
  sellerProfile: { alignItems: 'center', flexDirection: 'row' },
  sellerProfileCopy: { flex: 1, marginLeft: spacing.md },
  stats: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.md, flexDirection: 'row', marginTop: spacing.md, paddingVertical: spacing.md },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 18 },
  statLabel: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 11, marginTop: spacing.xxs },
  statDivider: { backgroundColor: colors.border, height: 28, width: StyleSheet.hairlineWidth },
  footer: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, bottom: 0, flexDirection: 'row', gap: 10, left: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, position: 'absolute', right: 0, ...shadows.floating },
  offerButton: { alignItems: 'center', borderColor: colors.text, borderRadius: 14, borderWidth: 1.5, flex: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: spacing.md },
  offerButtonText: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  actionHint: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption },
  buyButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14, flex: 1.45, justifyContent: 'center', minHeight: 52, paddingHorizontal: spacing.md },
  buyButtonDisabled: { backgroundColor: colors.textMuted },
  buyButtonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body, textAlign: 'center' },
  buyActionHint: { color: colors.white, fontFamily: fontFamily.regular, fontSize: fontSize.caption },
  pressed: { opacity: 0.78 },
  notFound: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xxl },
  notFoundTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.md },
  notFoundButton: { backgroundColor: colors.primary, borderRadius: radii.md, marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  notFoundButtonText: { color: colors.white, fontFamily: fontFamily.semibold, fontSize: fontSize.body },
});

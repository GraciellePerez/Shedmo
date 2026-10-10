import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PUBLIC_SHIPPING_ENABLED } from '@/config/launchFeatures';
import type { Listing } from '@/models';
import { colors, fontFamily, fontSize, radii, shadows, spacing } from '@/theme';
import { formatDistanceMiles } from '@/features/location/formatDistance';

interface ListingCardProps {
  listing: Listing;
  saved: boolean;
  onPress?: () => void;
  onToggleSaved: () => void;
  favoritePending?: boolean;
  listingStatus?: 'active' | 'sold';
  onSellerPress?: () => void;
}

export function ListingCard({
  favoritePending, listing, listingStatus = 'active', saved, onPress, onSellerPress, onToggleSaved,
}: ListingCardProps) {
  const [failedImageUri, setFailedImageUri] = useState<string | null>(null);
  const imageFailed = failedImageUri === listing.image;

  return (
    <Pressable
      accessibilityLabel={`View ${listing.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, shadows.card, pressed && styles.pressed]}
    >
      <View style={styles.imageWrap}>
        {!listing.image || imageFailed ? (
          <View style={styles.imageFallback}>
            <Ionicons color={colors.textMuted} name="image-outline" size={30} />
          </View>
        ) : (
          <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            onError={() => setFailedImageUri(listing.image)}
            recyclingKey={listing.id}
            source={listing.image}
            style={styles.image}
            transition={180}
          />
        )}
        {listingStatus === 'sold' ? (
          <View style={styles.soldBadge}>
            <Text style={styles.soldText}>SOLD</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityLabel={saved ? 'Remove from saved listings' : 'Save listing'}
          hitSlop={8}
          disabled={favoritePending}
          onPress={(event) => {
            event.stopPropagation();
            onToggleSaved();
          }}
          style={[styles.favorite, favoritePending && styles.favoritePending]}
        >
          <Ionicons color={saved ? colors.primary : colors.white} name={saved ? 'heart' : 'heart-outline'} size={19} />
        </Pressable>
      </View>
      <View style={styles.content}>
        <Text style={styles.price}>${listing.price}</Text>
        <Text numberOfLines={2} style={styles.title}>{listing.title}</Text>
        {onSellerPress ? (
          <Pressable
            accessibilityLabel={`View ${listing.seller.name}'s profile`}
            onPress={(event) => { event.stopPropagation(); onSellerPress(); }}
          >
            <Text numberOfLines={1} style={styles.seller}>{listing.seller.name}</Text>
          </Pressable>
        ) : null}
        <View style={styles.meta}>
          <Ionicons color={colors.textSecondary} name="location-outline" size={12} />
          <Text numberOfLines={1} style={styles.location}>{listing.location}</Text>
        </View>
        {formatDistanceMiles(listing.distanceMiles) ? (
          <Text style={styles.distance}>{formatDistanceMiles(listing.distanceMiles)}</Text>
        ) : null}
        <View style={styles.flags}>
          {PUBLIC_SHIPPING_ENABLED && listing.shipping ? <Text style={styles.flag}>Ships</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    flex: 1,
    overflow: 'hidden',
  },
  imageWrap: {
    aspectRatio: 1,
    backgroundColor: colors.background,
  },
  image: {
    height: '100%',
    width: '100%',
  },
  imageFallback: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  favorite: {
    alignItems: 'center',
    backgroundColor: colors.overlay,
    borderRadius: radii.round,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    width: 34,
  },
  favoritePending: { opacity: 0.55 },
  soldBadge: { backgroundColor: colors.text, borderRadius: radii.xs, left: spacing.sm, paddingHorizontal: 8, paddingVertical: 4, position: 'absolute', top: spacing.sm },
  soldText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.caption },
  content: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  price: {
    color: colors.text,
    fontFamily: fontFamily.extraBold,
    fontSize: fontSize.subtitle,
  },
  title: {
    color: colors.text,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.bodySmall,
    lineHeight: 17,
    marginTop: spacing.xxs,
    minHeight: 34,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  location: {
    color: colors.textSecondary,
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 11,
    marginLeft: spacing.xs,
  },
  distance: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 11, marginTop: spacing.xxs },
  seller: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: 11, marginTop: spacing.xxs },
  flags: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  flag: {
    color: colors.textSecondary,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.caption,
  },
  pressed: {
    opacity: 0.92,
  },
});

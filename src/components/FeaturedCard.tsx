import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Listing } from '@/models';
import { colors, fontFamily, radii, shadows, spacing } from '@/theme';

interface FeaturedCardProps {
  listing: Listing;
  saved: boolean;
  onPress?: () => void;
  onToggleSaved: () => void;
}

export function FeaturedCard({ listing, saved, onPress, onToggleSaved }: FeaturedCardProps) {
  const [failedImageUri, setFailedImageUri] = useState<string | null>(null);
  const imageFailed = failedImageUri === listing.image;

  return (
    <Pressable
      accessibilityLabel={`View ${listing.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, shadows.floating, pressed && styles.pressed]}
    >
      {!listing.image || imageFailed ? (
        <View style={styles.imageFallback}>
          <Ionicons color={colors.textMuted} name="image-outline" size={34} />
        </View>
      ) : (
        <Image
          cachePolicy="memory-disk"
          contentFit="cover"
          onError={() => setFailedImageUri(listing.image)}
          recyclingKey={`featured-${listing.id}`}
          source={listing.image}
          style={StyleSheet.absoluteFill}
          transition={180}
        />
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.78)']} style={StyleSheet.absoluteFill} />
      <Pressable
        accessibilityLabel={saved ? 'Remove from saved listings' : 'Save listing'}
        accessibilityRole="button"
        onPress={(event) => {
          event.stopPropagation();
          onToggleSaved();
        }}
        style={styles.favorite}
      >
        <Ionicons color={saved ? colors.primary : colors.white} name={saved ? 'heart' : 'heart-outline'} size={18} />
      </Pressable>
      <View style={styles.copy}>
        <Text style={styles.price}>${listing.price}</Text>
        <Text numberOfLines={1} style={styles.title}>{listing.title}</Text>
        <Text style={styles.location}>
          {listing.location}{listing.distance ? ` · ${listing.distance}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    height: 190,
    overflow: 'hidden',
    width: 240,
  },
  favorite: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radii.round,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    width: 32,
  },
  imageFallback: { ...StyleSheet.absoluteFill, alignItems: 'center', backgroundColor: colors.background, justifyContent: 'center' },
  copy: {
    bottom: spacing.lg,
    left: spacing.lg,
    position: 'absolute',
    right: spacing.lg,
  },
  price: {
    color: colors.white,
    fontFamily: fontFamily.extraBold,
    fontSize: 21,
  },
  title: {
    color: colors.white,
    fontFamily: fontFamily.semibold,
    fontSize: 14,
    marginTop: spacing.xxs,
  },
  location: {
    color: 'rgba(255,255,255,0.76)',
    fontFamily: fontFamily.regular,
    fontSize: 11,
    marginTop: spacing.xs,
  },
  pressed: {
    opacity: 0.92,
  },
});

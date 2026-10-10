import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ListingDraftPhoto } from '@/features/sell/types/listingDraft';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

interface PhotoGridProps {
  error?: string;
  onAdd: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  photos: ListingDraftPhoto[];
}

export function PhotoGrid({ error, onAdd, onMove, onRemove, photos }: PhotoGridProps) {
  return (
    <View>
      <View style={styles.grid}>
        {photos.map((photo, index) => (
          <View key={photo.id} style={styles.photoWrap}>
            <Image contentFit="cover" source={photo.uri} style={styles.photo} />
            {index === 0 ? <Text style={styles.cover}>COVER</Text> : null}
            <Pressable accessibilityLabel="Remove photo" onPress={() => onRemove(photo.id)} style={styles.remove}>
              <Ionicons color={colors.white} name="close" size={15} />
            </Pressable>
            <View style={styles.reorder}>
              <Pressable disabled={index === 0} onPress={() => onMove(index, -1)} style={styles.orderButton}>
                <Ionicons color={index === 0 ? colors.textMuted : colors.white} name="chevron-back" size={14} />
              </Pressable>
              <Pressable disabled={index === photos.length - 1} onPress={() => onMove(index, 1)} style={styles.orderButton}>
                <Ionicons color={index === photos.length - 1 ? colors.textMuted : colors.white} name="chevron-forward" size={14} />
              </Pressable>
            </View>
          </View>
        ))}
        {photos.length < 12 ? (
          <Pressable onPress={onAdd} style={[styles.add, error && styles.addError]}>
            <Ionicons color={colors.text} name="camera-outline" size={27} />
            <Text style={styles.addText}>{photos.length ? 'Add Photos' : 'Main Photo'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.helper}>Add up to 12 photos • First photo is the cover</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoWrap: { aspectRatio: 1, borderRadius: radii.md, overflow: 'hidden', position: 'relative', width: '31.5%' },
  photo: { height: '100%', width: '100%' },
  cover: { backgroundColor: colors.primary, borderRadius: radii.xs, color: colors.white, fontFamily: fontFamily.bold, fontSize: 8, left: 5, paddingHorizontal: 5, paddingVertical: 3, position: 'absolute', top: 5 },
  remove: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: radii.round, height: 24, justifyContent: 'center', position: 'absolute', right: 4, top: 4, width: 24 },
  reorder: { bottom: 4, flexDirection: 'row', gap: 3, position: 'absolute', right: 4 },
  orderButton: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: radii.xs, height: 24, justifyContent: 'center', width: 24 },
  add: { alignItems: 'center', aspectRatio: 1, backgroundColor: colors.background, borderColor: colors.textMuted, borderRadius: radii.md, borderStyle: 'dashed', borderWidth: 2, justifyContent: 'center', width: '31.5%' },
  addError: { borderColor: colors.primary },
  addText: { color: colors.textSecondary, fontFamily: fontFamily.semibold, fontSize: fontSize.caption, marginTop: 6 },
  helper: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 11, marginTop: spacing.md, textAlign: 'center' },
  error: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, marginTop: spacing.sm, textAlign: 'center' },
});

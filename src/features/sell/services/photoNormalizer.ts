import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import type { ListingDraftPhoto } from '@/features/sell/types/listingDraft';

const MAX_LONG_EDGE = 2400;
const JPEG_QUALITY = 0.85;
const MAX_BYTES = 8 * 1024 * 1024;

export async function normalizeSelectedPhoto(
  photo: ListingDraftPhoto,
  index: number,
): Promise<ListingDraftPhoto> {
  try {
    const original = await fetch(photo.uri);
    if (!original.ok || !(await original.arrayBuffer()).byteLength) throw new Error('unreadable');
    const longEdge = Math.max(photo.width ?? 0, photo.height ?? 0);
    const actions = longEdge > MAX_LONG_EDGE
      ? [{
        resize: (photo.width ?? 0) >= (photo.height ?? 0)
          ? { width: MAX_LONG_EDGE }
          : { height: MAX_LONG_EDGE },
      }]
      : [];
    const normalized = await manipulateAsync(photo.uri, actions, {
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    const response = await fetch(normalized.uri);
    if (!response.ok) throw new Error('conversion-read');
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error('empty-output');
    if (buffer.byteLength > MAX_BYTES) throw new Error('normalized-too-large');
    if (__DEV__) {
      console.info('[listing:photo:normalize]', {
        originalExtension: photo.fileName?.split('.').pop()?.toLowerCase() ?? null,
        originalMimeType: photo.mimeType ?? null,
        normalized: true,
        normalizedBytes: buffer.byteLength,
      });
    }
    return {
      ...photo,
      id: `${photo.id}-normalized`,
      uri: normalized.uri,
      fileName: `listing-photo-${Date.now()}-${index}.jpg`,
      fileSize: buffer.byteLength,
      mimeType: 'image/jpeg',
      width: normalized.width,
      height: normalized.height,
    };
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'normalized-too-large') {
      throw new Error(`Photo ${index + 1} is still larger than 8 MB after conversion.`);
    }
    throw new Error(`Photo ${index + 1} could not be converted to JPEG. Choose another image.`);
  }
}

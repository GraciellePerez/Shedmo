import * as ImageManipulator from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const CHAT_IMAGE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
const CHAT_IMAGE_MAX_DIMENSION = 2048;

export interface PreparedChatImage {
  uri: string;
  bytes: Uint8Array;
}

export async function prepareChatImage(asset: ImagePickerAsset): Promise<PreparedChatImage> {
  if (asset.fileSize && asset.fileSize > CHAT_IMAGE_SOURCE_MAX_BYTES) {
    throw new Error('Choose a photo that is 20 MB or smaller.');
  }
  const resize = asset.width >= asset.height
    ? { width: CHAT_IMAGE_MAX_DIMENSION }
    : { height: CHAT_IMAGE_MAX_DIMENSION };
  const actions = asset.width > CHAT_IMAGE_MAX_DIMENSION || asset.height > CHAT_IMAGE_MAX_DIMENSION
    ? [{ resize }]
    : [];
  const result = await ImageManipulator.manipulateAsync(
    asset.uri,
    actions,
    { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!result.base64) throw new Error('The selected photo could not be prepared.');
  const bytes = decodeBase64(result.base64);
  if (bytes.byteLength === 0 || bytes.byteLength > CHAT_IMAGE_MAX_BYTES) {
    throw new Error('Choose a photo that can be reduced to 5 MB or smaller.');
  }
  return { uri: result.uri, bytes };
}

export function createChatUploadId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Number.parseInt(hex(), 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function decodeBase64(encoded: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const value = encoded.replace(/=+$/, '');
  if (value.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(value)) {
    throw new Error('The selected photo could not be decoded.');
  }
  const bytes = new Uint8Array(Math.floor(value.length * 3 / 4));
  let buffer = 0;
  let bitCount = 0;
  let offset = 0;
  for (const character of value) {
    buffer = (buffer << 6) | alphabet.indexOf(character);
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[offset] = (buffer >> bitCount) & 0xff;
      offset += 1;
    }
  }
  return bytes;
}

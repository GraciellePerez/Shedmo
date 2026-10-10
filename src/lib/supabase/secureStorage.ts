import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK_SIZE = 1800;
const PREFIX = 'pm_auth_';

function keyFor(key: string) {
  return `${PREFIX}${key.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function webStorage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export const secureSessionStorage = {
  async getItem(key: string) {
    if (Platform.OS === 'web') return webStorage()?.getItem(key) ?? null;
    const safeKey = keyFor(key);
    const countValue = await SecureStore.getItemAsync(`${safeKey}.count`);
    if (!countValue) return null;
    const count = Number(countValue);
    if (!Number.isInteger(count) || count < 1) return null;
    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(`${safeKey}.${index}`)),
    );
    return chunks.some((chunk) => chunk === null) ? null : chunks.join('');
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === 'web') {
      webStorage()?.setItem(key, value);
      return;
    }
    const safeKey = keyFor(key);
    const oldCount = Number(await SecureStore.getItemAsync(`${safeKey}.count`) ?? 0);
    const chunks = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'gs')) ?? [''];
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(`${safeKey}.${index}`, chunk)));
    await SecureStore.setItemAsync(`${safeKey}.count`, String(chunks.length));
    if (oldCount > chunks.length) {
      await Promise.all(
        Array.from({ length: oldCount - chunks.length }, (_, index) => SecureStore.deleteItemAsync(`${safeKey}.${chunks.length + index}`)),
      );
    }
  },
  async removeItem(key: string) {
    if (Platform.OS === 'web') {
      webStorage()?.removeItem(key);
      return;
    }
    const safeKey = keyFor(key);
    const count = Number(await SecureStore.getItemAsync(`${safeKey}.count`) ?? 0);
    await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(`${safeKey}.${index}`)),
    );
    await SecureStore.deleteItemAsync(`${safeKey}.count`);
  },
};

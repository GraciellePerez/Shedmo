import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'pm_expo_push_token';

export function getStoredPushToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export function storePushToken(token: string) {
  return SecureStore.setItemAsync(TOKEN_KEY, token);
}

export function clearStoredPushToken() {
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}


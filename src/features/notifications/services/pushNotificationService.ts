import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type {
  MarketplacePushPayload, PushPermissionState,
} from '@/features/notifications/types/pushNotification';

type PushPermissionResponse = Notifications.NotificationPermissionsStatus & {
  canAskAgain: boolean;
  granted: boolean;
};

export async function getPushPermissionState(): Promise<PushPermissionState> {
  if (!Device.isDevice || Platform.OS === 'web') return 'unavailable';
  try {
    const permission = await Notifications.getPermissionsAsync() as PushPermissionResponse;
    if (permission.granted) return 'granted';
    return permission.canAskAgain ? 'unknown' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function requestPushPermission() {
  const current = await getPushPermissionState();
  if (current === 'unavailable' || current === 'denied') return current;
  const result = await Notifications.requestPermissionsAsync() as PushPermissionResponse;
  return result.granted ? 'granted' as const : 'denied' as const;
}

export async function configureAndroidPushChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('marketplace', {
    name: 'Shedmo activity',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
}

export async function getExpoPushToken() {
  const projectId = Constants.easConfig?.projectId
    ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('An EAS project ID is required for push notifications.');
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  return result.data;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePushPayload(value: unknown): MarketplacePushPayload | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    data.type !== 'new_message'
    && data.type !== 'listing_favorited'
    && data.type !== 'local_sale_confirmation'
  ) return null;
  if (typeof data.notificationId !== 'string' || !uuid.test(data.notificationId)) return null;
  const optionalId = (key: string) =>
    data[key] == null ? undefined : typeof data[key] === 'string' && uuid.test(data[key] as string)
      ? data[key] as string : null;
  const conversationId = optionalId('conversationId');
  const listingId = optionalId('listingId');
  const actorId = optionalId('actorId');
  if (conversationId === null || listingId === null || actorId === null) return null;
  if (data.type === 'new_message' && !conversationId) return null;
  if (data.type === 'listing_favorited' && !listingId) return null;
  if (data.type === 'local_sale_confirmation' && !listingId) return null;
  return { type: data.type, notificationId: data.notificationId, conversationId, listingId, actorId };
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';
import { Linking } from 'react-native';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import {
  disablePushToken, registerPushToken,
} from '@/features/notifications/services/pushTokenRepository';
import {
  configureAndroidPushChannel, getExpoPushToken, getPushPermissionState,
  parsePushPayload, requestPushPermission,
} from '@/features/notifications/services/pushNotificationService';
import type { PushPermissionState } from '@/features/notifications/types/pushNotification';
import {
  clearStoredPushToken,
  getStoredPushToken,
  storePushToken,
} from '@/features/notifications/services/pushTokenStorage';

interface PushContextValue {
  error: string | null;
  loading: boolean;
  permission: PushPermissionState;
  registered: boolean;
  disableOnDevice: () => Promise<void>;
  enable: () => Promise<void>;
  openSettings: () => Promise<void>;
}

const PushContext = createContext<PushContextValue | null>(null);

export function PushNotificationProvider({ children }: PropsWithChildren) {
  const { session } = useAuthStore();
  const userId = session?.user.id ?? null;
  const router = useRouter();
  const navigation = useRootNavigationState();
  const [permission, setPermission] = useState<PushPermissionState>('unknown');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const handledResponse = useRef<string | null>(null);
  const pendingResponse = useRef<Notifications.NotificationResponse | null>(null);

  const persistRegistration = useCallback(async (token: string) => {
    if (!userId) return;
    const previousToken = await getStoredPushToken();
    if (previousToken && previousToken !== token) {
      await disablePushToken(previousToken);
    }
    await registerPushToken(token, null);
    await storePushToken(token);
    setRegistered(true);
  }, [userId]);

  const register = useCallback(async () => {
    if (!userId) return;
    await configureAndroidPushChannel();
    const token = await getExpoPushToken();
    await persistRegistration(token);
  }, [persistRegistration, userId]);

  useEffect(() => {
    let active = true;
    void getPushPermissionState().then(async (state) => {
      if (!active) return;
      setPermission(state);
      if (state === 'granted' && userId) {
        try { await register(); } catch { if (active) setError('Push registration is temporarily unavailable.'); }
      }
    });
    return () => { active = false; };
  }, [register, userId]);

  const navigateResponse = useCallback((response: Notifications.NotificationResponse) => {
    if (!navigation?.key || !userId) {
      pendingResponse.current = response;
      return;
    }
    const identifier = response.notification.request.identifier;
    if (handledResponse.current === identifier) return;
    handledResponse.current = identifier;
    const payload = parsePushPayload(response.notification.request.content.data);
    if (!payload) {
      router.push('/notifications');
    } else if (payload.type === 'new_message' && payload.conversationId) {
      router.push({ pathname: '/conversations/[id]', params: { id: payload.conversationId } });
    } else if (payload.type === 'local_sale_confirmation' && payload.listingId) {
      router.push({ pathname: '/local-sale/[listingId]', params: { listingId: payload.listingId } });
    } else if (payload.type === 'listing_favorited' && payload.listingId) {
      router.push({ pathname: '/listings/[id]', params: { id: payload.listingId } });
    } else router.push('/notifications');
  }, [navigation?.key, router, userId]);

  useEffect(() => {
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(navigateResponse);
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      if (token.type === 'expo' && userId) void persistRegistration(token.data).catch(() => undefined);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) navigateResponse(response);
    }).catch(() => undefined);
    return () => {
      responseSubscription.remove();
      tokenSubscription.remove();
    };
  }, [navigateResponse, persistRegistration, userId]);

  useEffect(() => {
    if (navigation?.key && userId && pendingResponse.current) {
      const response = pendingResponse.current;
      pendingResponse.current = null;
      navigateResponse(response);
    }
  }, [navigateResponse, navigation?.key, userId]);

  const enable = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await requestPushPermission();
      setPermission(next);
      if (next === 'granted') await register();
      else if (next === 'denied') setError('Notification permission is denied. Enable it in system settings.');
      else setError('Push notifications are unavailable on this device.');
    } catch {
      setError('Could not enable push notifications. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [loading, register]);

  const disableOnDevice = useCallback(async () => {
    const token = await getStoredPushToken();
    if (token && userId) await disablePushToken(token);
    await clearStoredPushToken();
    setRegistered(false);
  }, [userId]);

  const value = useMemo<PushContextValue>(() => ({
    disableOnDevice,
    enable,
    error,
    loading,
    permission,
    registered,
    openSettings: () => Linking.openSettings(),
  }), [disableOnDevice, enable, error, loading, permission, registered]);

  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePushNotifications() {
  const value = useContext(PushContext);
  if (!value) throw new Error('usePushNotifications must be used within PushNotificationProvider.');
  return value;
}

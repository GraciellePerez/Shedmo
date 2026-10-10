import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import {
  deleteNotification as deleteRemoteNotification,
  fetchNotifications,
  fetchNotificationUnreadCount,
  markAllNotificationsRead as markAllRemoteRead,
  markNotificationRead as markRemoteRead,
  subscribeToNotificationChanges,
  unsubscribeFromNotificationChanges,
} from '@/features/notifications/services/notificationRepository';
import type { MarketplaceNotification } from '@/features/notifications/types/notification';

interface NotificationStoreValue {
  notifications: MarketplaceNotification[];
  unreadCount: number;
  error: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  deleteNotification: (id: string) => Promise<boolean>;
  loadMore: () => Promise<void>;
  markAllRead: () => Promise<boolean>;
  markRead: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const NotificationStoreContext = createContext<NotificationStoreValue | null>(null);

export function NotificationStoreProvider({ children }: PropsWithChildren) {
  const { initializing, session } = useAuthStore();
  const userId = session?.user.id ?? null;
  const [storedUserId, setStoredUserId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<MarketplaceNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(0);
  const generationRef = useRef(0);
  const subscriptionRef = useRef<RealtimeChannel | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const unreadSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (targetUserId: string, refreshMode = false) => {
    const generation = generationRef.current;
    if (refreshMode) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [page, unread] = await Promise.all([
        fetchNotifications(targetUserId, 0),
        fetchNotificationUnreadCount(targetUserId),
      ]);
      if (generation !== generationRef.current || targetUserId !== userId) return;
      setStoredUserId(targetUserId);
      setNotifications(page.items);
      setUnreadCount(unread);
      setHasMore(page.hasMore);
      pageRef.current = page.nextPage;
    } catch {
      if (generation === generationRef.current) {
        setError('Notifications could not be loaded. Check your connection and try again.');
      }
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    generationRef.current += 1;
    void unsubscribeFromNotificationChanges(subscriptionRef.current);
    subscriptionRef.current = null;
    setStoredUserId(null);
    setNotifications([]);
    setUnreadCount(0);
    setHasMore(false);
    setError(null);
    pageRef.current = 0;

    if (!initializing && userId) {
      subscriptionRef.current = subscribeToNotificationChanges(userId, (event, notification) => {
        if (notification.userId !== userId) return;
        setStoredUserId(userId);
        setNotifications((current) => {
          const existing = current.find((item) => item.id === notification.id);
          if (event === 'DELETE') return current.filter((item) => item.id !== notification.id);
          if (event === 'UPDATE') {
            return existing
              ? current.map((item) => item.id === notification.id ? notification : item)
              : [notification, ...current];
          }
          return existing ? current : [notification, ...current];
        });
        if (unreadSyncTimerRef.current) clearTimeout(unreadSyncTimerRef.current);
        unreadSyncTimerRef.current = setTimeout(() => {
          unreadSyncTimerRef.current = null;
          void fetchNotificationUnreadCount(userId).then(setUnreadCount).catch(() => {
            setError('Notification count could not be synchronized. Pull to refresh.');
          });
        }, 250);
      }, (status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Live notification updates were interrupted. Pull to refresh if needed.');
        }
      });
      void load(userId);
    } else setLoading(false);

    return () => {
      if (unreadSyncTimerRef.current) clearTimeout(unreadSyncTimerRef.current);
      unreadSyncTimerRef.current = null;
      void unsubscribeFromNotificationChanges(subscriptionRef.current);
      subscriptionRef.current = null;
    };
  }, [initializing, load, userId]);

  const refresh = useCallback(async () => {
    if (userId) await load(userId, true);
  }, [load, userId]);

  const loadMore = useCallback(async () => {
    if (
      !userId
      || storedUserId !== userId
      || loadMoreInFlightRef.current
      || !hasMore
    ) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    const generation = generationRef.current;
    try {
      const page = await fetchNotifications(userId, pageRef.current);
      if (generation !== generationRef.current) return;
      setNotifications((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setHasMore(page.hasMore);
      pageRef.current = page.nextPage;
    } catch {
      if (generation === generationRef.current) {
        setError('More notifications could not be loaded. Try again.');
      }
    } finally {
      loadMoreInFlightRef.current = false;
      if (generation === generationRef.current) setLoadingMore(false);
    }
  }, [hasMore, storedUserId, userId]);

  const markRead = useCallback(async (id: string) => {
    const existing = notifications.find((item) => item.id === id);
    if (!existing || existing.isRead) return true;
    setNotifications((current) => current.map((item) =>
      item.id === id ? { ...item, isRead: true } : item));
    setUnreadCount((current) => Math.max(0, current - 1));
    try {
      await markRemoteRead(id);
      return true;
    } catch {
      setNotifications((current) => current.map((item) =>
        item.id === id ? { ...item, isRead: false } : item));
      setUnreadCount((current) => current + 1);
      setError('Read status could not be updated. Try again.');
      return false;
    }
  }, [notifications]);

  const markAllRead = useCallback(async () => {
    if (!userId || unreadCount === 0) return true;
    const previous = notifications;
    const previousUnread = unreadCount;
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
    try {
      await markAllRemoteRead(userId);
      return true;
    } catch {
      setNotifications(previous);
      setUnreadCount(previousUnread);
      setError('Notifications could not be marked read. Try again.');
      return false;
    }
  }, [notifications, unreadCount, userId]);

  const deleteNotification = useCallback(async (id: string) => {
    const existing = notifications.find((item) => item.id === id);
    if (!existing) return true;
    setNotifications((current) => current.filter((item) => item.id !== id));
    if (!existing.isRead) setUnreadCount((current) => Math.max(0, current - 1));
    try {
      await deleteRemoteNotification(id);
      return true;
    } catch {
      setNotifications((current) => [existing, ...current]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      if (!existing.isRead) setUnreadCount((current) => current + 1);
      setError('Notification could not be deleted. Try again.');
      return false;
    }
  }, [notifications]);

  const visibleNotifications = useMemo(
    () => storedUserId === userId ? notifications : [],
    [notifications, storedUserId, userId],
  );
  const value = useMemo<NotificationStoreValue>(() => ({
    notifications: visibleNotifications,
    unreadCount: storedUserId === userId ? unreadCount : 0,
    error,
    hasMore: storedUserId === userId && hasMore,
    loading,
    loadingMore,
    refreshing,
    deleteNotification,
    loadMore,
    markAllRead,
    markRead,
    refresh,
  }), [
    deleteNotification, error, hasMore, loadMore, loading, loadingMore, markAllRead,
    markRead, refresh, refreshing, storedUserId, unreadCount, userId, visibleNotifications,
  ]);

  return <NotificationStoreContext.Provider value={value}>{children}</NotificationStoreContext.Provider>;
}

export function useNotificationStore() {
  const value = useContext(NotificationStoreContext);
  if (!value) throw new Error('useNotificationStore must be used within NotificationStoreProvider.');
  return value;
}

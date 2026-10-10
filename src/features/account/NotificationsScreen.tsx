import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountEmptyState } from '@/features/account/components/AccountEmptyState';
import { AccountTabs } from '@/features/account/components/AccountTabs';
import { useNotificationStore } from '@/features/notifications/store/NotificationStore';
import type {
  MarketplaceNotification, NotificationFilter,
} from '@/features/notifications/types/notification';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

const filters: { label: string; value: NotificationFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Messages', value: 'messages' },
  { label: 'Favorites', value: 'favorites' },
];

export function NotificationsScreen() {
  const router = useRouter();
  const {
    deleteNotification, error, hasMore, loadMore, loading, loadingMore, markAllRead,
    markRead, notifications, refresh, refreshing, unreadCount,
  } = useNotificationStore();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const items = useMemo(() => notifications.filter((item) =>
    filter === 'all'
    || (filter === 'messages' && item.type === 'new_message')
    || (filter === 'favorites' && item.type === 'listing_favorited')),
  [filter, notifications]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  const open = async (item: MarketplaceNotification) => {
    await markRead(item.id);
    if (item.type === 'new_message' && item.conversationId) {
      router.push({ pathname: '/conversations/[id]', params: { id: item.conversationId } });
    } else if (item.type === 'local_sale_confirmation' && item.listingId) {
      router.push({ pathname: '/local-sale/[listingId]', params: { listingId: item.listingId } });
    } else if (item.listingId) {
      router.push({ pathname: '/listings/[id]', params: { id: item.listingId } });
    }
  };

  const confirmDelete = (item: MarketplaceNotification) => Alert.alert(
    'Delete notification?',
    'This notification will be permanently removed.',
    [
      { style: 'cancel', text: 'Cancel' },
      { style: 'destructive', text: 'Delete', onPress: () => void deleteNotification(item.id) },
    ],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader
        right={
          <Pressable disabled={unreadCount === 0} hitSlop={8} onPress={() => void markAllRead()}>
            <Text style={[styles.markAll, unreadCount === 0 && styles.disabled]}>Read all</Text>
          </Pressable>
        }
        title="Notifications"
      />
      <AccountTabs items={filters} onChange={setFilter} value={filter} />
      <FlatList
        contentContainerStyle={[styles.content, !items.length && styles.emptyContent]}
        data={items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          loading ? (
            <View style={styles.status}>
              <Text style={styles.statusTitle}>Loading notifications…</Text>
            </View>
          ) : error ? (
            <View style={styles.status}>
              <Text style={styles.statusTitle}>Notifications unavailable</Text>
              <Text style={styles.statusBody}>{error}</Text>
              <Pressable onPress={() => void refresh()} style={styles.retry}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : <AccountEmptyState body="There are no notifications in this category." title="All caught up" />
        }
        ListFooterComponent={loadingMore ? <Text style={styles.footer}>Loading more…</Text> : null}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.5}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void open(item)}
            style={({ pressed }) => [styles.row, !item.isRead && styles.unread, pressed && styles.pressed]}
          >
            <Pressable
              accessibilityLabel={item.actorId ? 'View marketplace profile' : undefined}
              disabled={!item.actorId}
              onPress={(event) => {
                event.stopPropagation();
                if (item.actorId) router.push({ pathname: '/sellers/[id]', params: { id: item.actorId } });
              }}
              style={[styles.icon, !item.isRead && styles.unreadIcon]}
            >
              <Ionicons
                color={item.isRead ? colors.textSecondary : colors.primary}
                name={item.type === 'new_message' ? 'chatbubble-outline' : item.type === 'local_sale_confirmation' ? 'checkmark-circle-outline' : 'heart-outline'}
                size={20}
              />
            </Pressable>
            <View style={styles.copy}>
              <Text style={[styles.title, !item.isRead && styles.unreadTitle]}>{item.title}</Text>
              <Text style={styles.description}>{item.body}</Text>
              <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
            </View>
            {!item.isRead ? <View style={styles.dot} /> : null}
            <Pressable
              accessibilityLabel="Delete notification"
              hitSlop={8}
              onPress={(event) => {
                event.stopPropagation();
                confirmDelete(item);
              }}
              style={styles.delete}
            >
              <Ionicons color={colors.textSecondary} name="trash-outline" size={17} />
            </Pressable>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days}d`;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  markAll: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.footnote },
  disabled: { color: colors.textMuted },
  content: { backgroundColor: colors.background, flexGrow: 1, paddingTop: spacing.md },
  emptyContent: { justifyContent: 'center' },
  row: { alignItems: 'flex-start', backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 14 },
  unread: { backgroundColor: '#FFF8F8' },
  pressed: { opacity: 0.75 },
  icon: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.round, height: 42, justifyContent: 'center', width: 42 },
  unreadIcon: { backgroundColor: '#FFF1F0' },
  copy: { flex: 1 },
  title: { color: colors.text, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall },
  unreadTitle: { fontFamily: fontFamily.bold },
  description: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 18, marginTop: 3 },
  time: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: 4 },
  dot: { backgroundColor: colors.primary, borderRadius: 5, height: 10, marginTop: 5, width: 10 },
  delete: { alignItems: 'center', height: 30, justifyContent: 'center', width: 26 },
  status: { alignItems: 'center', padding: spacing.xxxl },
  statusTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title },
  statusBody: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, marginTop: spacing.sm, textAlign: 'center' },
  retry: { backgroundColor: colors.primary, borderRadius: 12, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.bodySmall },
  footer: { color: colors.textSecondary, fontFamily: fontFamily.medium, padding: spacing.lg, textAlign: 'center' },
});

import type { RealtimeChannel } from '@supabase/supabase-js';

import type {
  DatabaseNotification, MarketplaceNotification, NotificationPage,
} from '@/features/notifications/types/notification';
import { requireSupabase } from '@/lib/supabase/client';

const PAGE_SIZE = 20;

export async function fetchNotifications(userId: string, page = 0): Promise<NotificationPage> {
  const from = page * PAGE_SIZE;
  const { data, error } = await requireSupabase().from('notifications')
    .select('id,user_id,actor_id,type,title,body,listing_id,conversation_id,is_read,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE_SIZE);
  if (error) throw error;
  const rows = (data ?? []) as DatabaseNotification[];
  return {
    items: rows.slice(0, PAGE_SIZE).map(mapNotification),
    hasMore: rows.length > PAGE_SIZE,
    nextPage: page + 1,
  };
}

export async function fetchNotificationUnreadCount(userId: string) {
  const { count, error } = await requireSupabase().from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id: string) {
  const { error } = await requireSupabase().from('notifications')
    .update({ is_read: true }).eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string) {
  const { error } = await requireSupabase().from('notifications')
    .update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
  if (error) throw error;
}

export async function deleteNotification(id: string) {
  const { error } = await requireSupabase().from('notifications').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeToNotificationChanges(
  userId: string,
  onChange: (event: 'INSERT' | 'UPDATE' | 'DELETE', notification: MarketplaceNotification) => void,
  onStatus?: (status: string) => void,
) {
  return requireSupabase().channel(`notifications:${userId}:${Date.now()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as DatabaseNotification;
        if (row?.id) onChange(payload.eventType, mapNotification(row));
      },
    )
    .subscribe((status) => onStatus?.(status));
}

export async function unsubscribeFromNotificationChanges(channel: RealtimeChannel | null) {
  if (channel) await requireSupabase().removeChannel(channel);
}

function mapNotification(row: DatabaseNotification): MarketplaceNotification {
  return {
    id: row.id,
    userId: row.user_id,
    actorId: row.actor_id,
    type: row.type,
    title: row.title,
    body: row.body,
    listingId: row.listing_id,
    conversationId: row.conversation_id,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

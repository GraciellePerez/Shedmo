import type { RealtimeChannel } from '@supabase/supabase-js';

import { mapDatabaseListing } from '@/features/listings/services/listingRepository';
import type { DatabaseListing } from '@/features/listings/types/listing';
import type {
  ConversationPage, DatabaseMessage, ImageMessage, MarketplaceConversation, MarketplaceMessage, MessagePage,
  TextMessage,
} from '@/features/messaging/types/messaging';
import { requireSupabase } from '@/lib/supabase/client';
import { telemetry } from '@/services/telemetry';

const CONVERSATION_PAGE_SIZE = 20;
const MESSAGE_PAGE_SIZE = 30;
const conversationSelect = `
  *,
  listing:listings!conversations_listing_id_fkey (
    *,
    listing_images (*),
    seller:profiles!listings_seller_id_fkey (
      id, display_name, username, avatar_url, city, state, created_at
    )
  ),
  buyer:profiles!conversations_buyer_id_fkey (
    id, display_name, username, avatar_url
  ),
  seller:profiles!conversations_seller_id_fkey (
    id, display_name, username, avatar_url
  ),
  messages (id, conversation_id, sender_id, body, created_at, edited_at, deleted_at,
    attachment_path, attachment_mime_type, attachment_size_bytes, moderation_hidden_at)
`;

interface DatabaseConversation {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  listing: DatabaseListing | null;
  buyer: DatabaseParticipant | null;
  seller: DatabaseParticipant | null;
  messages?: DatabaseMessage[];
}

interface DatabaseParticipant {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export async function createOrGetConversation(
  listingId: string,
  buyerId: string,
  sellerId: string,
) {
  const existing = await findConversation(listingId, buyerId, sellerId);
  if (existing) return existing;
  const { error } = await requireSupabase().from('conversations').upsert(
    { listing_id: listingId, buyer_id: buyerId, seller_id: sellerId },
    { onConflict: 'listing_id,buyer_id,seller_id', ignoreDuplicates: true },
  );
  if (error) throw error;
  const created = await findConversation(listingId, buyerId, sellerId);
  if (!created) throw new Error('Conversation could not be opened.');
  telemetry.track('conversation_started', 'conversation', created);
  return created;
}

export async function fetchConversations(userId: string, page = 0): Promise<ConversationPage> {
  const from = page * CONVERSATION_PAGE_SIZE;
  const { data, error } = await requireSupabase().from('conversations')
    .select(conversationSelect)
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .order('created_at', { ascending: false, referencedTable: 'messages' })
    .order('id', { ascending: false, referencedTable: 'messages' })
    .limit(1, { referencedTable: 'messages' })
    .range(from, from + CONVERSATION_PAGE_SIZE);
  if (error) throw error;
  const rows = (data ?? []) as unknown as DatabaseConversation[];
  const unread = await fetchUnreadCounts();
  return {
    items: await Promise.all(rows.slice(0, CONVERSATION_PAGE_SIZE)
      .map((row) => mapConversation(row, userId, unread.get(row.id) ?? 0))),
    hasMore: rows.length > CONVERSATION_PAGE_SIZE,
    nextPage: page + 1,
  };
}

export async function fetchConversation(id: string, userId: string) {
  const { data, error } = await requireSupabase().from('conversations')
    .select(conversationSelect)
    .eq('id', id)
    .order('created_at', { ascending: false, referencedTable: 'messages' })
    .order('id', { ascending: false, referencedTable: 'messages' })
    .limit(1, { referencedTable: 'messages' })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const unread = await fetchUnreadCounts();
  return mapConversation(data as unknown as DatabaseConversation, userId, unread.get(id) ?? 0);
}

export async function fetchMessages(
  conversationId: string,
  userId: string,
  page = 0,
): Promise<MessagePage> {
  const from = page * MESSAGE_PAGE_SIZE;
  const { data, error } = await requireSupabase().from('messages')
    .select('id,conversation_id,sender_id,body,created_at,edited_at,deleted_at,attachment_path,attachment_mime_type,attachment_size_bytes,moderation_hidden_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + MESSAGE_PAGE_SIZE);
  if (error) throw error;
  const rows = (data ?? []) as DatabaseMessage[];
  return {
    items: rows.slice(0, MESSAGE_PAGE_SIZE).reverse().map((row) => mapMessage(row, userId)),
    hasMore: rows.length > MESSAGE_PAGE_SIZE,
    nextPage: page + 1,
  };
}

export async function sendMessage(conversationId: string, senderId: string, body: string) {
  const { data, error } = await requireSupabase().from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, body: body.trim() })
    .select('*').single();
  if (error) throw error;
  telemetry.track('message_sent', 'conversation', conversationId);
  return mapMessage(data as DatabaseMessage, senderId);
}

export async function sendChatImageMessage(
  conversationId: string,
  senderId: string,
  uploadId: string,
  imageBytes: Uint8Array,
  caption: string,
) {
  const client = requireSupabase();
  const { data: reservation, error: reservationError } = await client.rpc('create_chat_image_upload_v1', {
    p_conversation_id: conversationId,
    p_upload_id: uploadId,
  });
  if (reservationError) throw reservationError;
  if (!reservation || typeof reservation !== 'object') throw new Error('Image upload reservation was invalid.');
  const storagePath = (reservation as { storage_path?: unknown }).storage_path;
  const expectedPath = `${conversationId}/${senderId}/${uploadId}.jpg`;
  if (storagePath !== expectedPath) throw new Error('Image upload reservation did not match this conversation.');

  const { error: uploadError } = await client.storage.from('chat-images').upload(storagePath, imageBytes, {
    cacheControl: '0',
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
    const cleanup = await client.storage.from('chat-images').remove([storagePath]);
    if (!cleanup.error) {
      const cancelled = await client.rpc('cancel_chat_image_upload_v1', { p_upload_id: uploadId });
      if (cancelled.error) throw cancelled.error;
    }
    throw uploadError;
  }

  const { data, error } = await client.rpc('send_chat_image_v1', {
    p_upload_id: uploadId,
    p_caption: caption.trim() || null,
  });
  if (error) {
    const { data: recovered, error: recoveryError } = await client.from('messages')
      .select('id,conversation_id,sender_id,body,created_at,edited_at,deleted_at,attachment_path,attachment_mime_type,attachment_size_bytes,moderation_hidden_at')
      .eq('id', uploadId)
      .eq('sender_id', senderId)
      .maybeSingle();
    if (recoveryError) throw error;
    if (!recovered) {
      const cleanup = await client.storage.from('chat-images').remove([storagePath]);
      if (!cleanup.error) {
        const cancelled = await client.rpc('cancel_chat_image_upload_v1', { p_upload_id: uploadId });
        if (cancelled.error) throw cancelled.error;
      }
      throw error;
    }
    telemetry.track('message_sent', 'conversation', conversationId);
    return mapMessage(recovered as DatabaseMessage, senderId);
  }
  if (!data || typeof data !== 'object') throw new Error('Image message response was invalid.');
  telemetry.track('message_sent', 'conversation', conversationId);
  return mapMessage(data as DatabaseMessage, senderId);
}

export async function createChatImageSignedUrl(path: string) {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(path)) {
    throw new Error('Invalid chat image path.');
  }
  const { data, error } = await requireSupabase().storage
    .from('chat-images').createSignedUrl(path, 60);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Chat image is unavailable.');
  return data.signedUrl;
}

export async function discardChatImageUpload(
  conversationId: string,
  senderId: string,
  uploadId: string,
) {
  const client = requireSupabase();
  const path = `${conversationId}/${senderId}/${uploadId}.jpg`;
  const { error: storageError } = await client.storage.from('chat-images').remove([path]);
  if (storageError) throw storageError;
  const { error } = await client.rpc('cancel_chat_image_upload_v1', { p_upload_id: uploadId });
  if (error) throw error;
}

export async function markConversationRead(conversationId: string, userId: string) {
  const { error } = await requireSupabase().from('conversation_reads').upsert(
    { conversation_id: conversationId, user_id: userId, last_read_at: new Date().toISOString() },
    { onConflict: 'conversation_id,user_id' },
  );
  if (error) throw error;
}

export async function fetchUnreadCounts() {
  const { data, error } = await requireSupabase().rpc('get_my_conversation_unread_counts');
  if (error) throw error;
  return new Map<string, number>(
    ((data ?? []) as { conversation_id: string; unread_count: number | string }[])
      .map((row) => [row.conversation_id, Number(row.unread_count)]),
  );
}

export async function fetchUnreadMessageCount() {
  const counts = await fetchUnreadCounts();
  return [...counts.values()].reduce((total, count) => total + count, 0);
}

export async function subscribeToConversationMessages(
  conversationId: string,
  userId: string,
  onMessage: (message: MarketplaceMessage) => void,
  onStatus?: (status: string) => void,
  onMessageUpdated?: (message: MarketplaceMessage) => void,
) {
  const conversation = await fetchConversation(conversationId, userId);
  if (!conversation || ![conversation.buyerId, conversation.sellerId].includes(userId)) {
    throw new Error('You are not a participant in this conversation.');
  }
  return requireSupabase().channel(`conversation:${conversationId}:${Date.now()}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onMessage(mapMessage(payload.new as DatabaseMessage, userId)),
    )
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}`,
    }, (payload) => onMessageUpdated?.(mapMessage(payload.new as DatabaseMessage, userId)))
    .subscribe((status) => onStatus?.(status));
}

export async function unsubscribeFromMessages(channel: RealtimeChannel | null) {
  if (channel) await requireSupabase().removeChannel(channel);
}

export function subscribeToConversationUpdates(userId: string, onChange: () => void) {
  return (['buyer_id', 'seller_id'] as const).map((participantColumn) =>
    requireSupabase().channel(`inbox:${participantColumn}:${userId}:${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `${participantColumn}=eq.${userId}`,
        },
        onChange,
      )
      .subscribe(),
  );
}

export async function unsubscribeFromConversationUpdates(channels: RealtimeChannel[]) {
  await Promise.all(channels.map((channel) => requireSupabase().removeChannel(channel)));
}

async function findConversation(listingId: string, buyerId: string, sellerId: string) {
  const { data, error } = await requireSupabase().from('conversations')
    .select('id')
    .eq('listing_id', listingId)
    .eq('buyer_id', buyerId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (error) throw error;
  return data?.id as string | undefined;
}

async function mapConversation(
  row: DatabaseConversation,
  userId: string,
  unread: number,
): Promise<MarketplaceConversation> {
  const listing = row.listing ? await mapDatabaseListing(row.listing) : {
    id: row.listing_id, title: 'Listing unavailable', image: '', price: 0, pickup: false,
  };
  const relationship = row.buyer_id === userId ? 'buying' : 'selling';
  const other = relationship === 'buying' ? row.seller : row.buyer;
  const name = other?.display_name?.trim() || other?.username?.trim() || 'Shedmo User';
  const latest = (row.messages ?? []).slice(0, 1).map((message) => mapMessage(message, userId));
  const timestamp = row.last_message_at ?? row.created_at;
  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    participant: {
      id: other?.id ?? '',
      name,
      initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      avatarColor: '#007AFF',
      avatarUrl: other?.avatar_url ?? undefined,
    },
    relationship,
    listing: { id: listing.id, title: listing.title, image: listing.image, price: listing.price, pickup: listing.pickup, unavailable: !row.listing },
    messages: latest,
    unread,
    updatedAt: new Date(timestamp).getTime(),
    timeAgo: relativeTime(timestamp),
  };
}

function mapMessage(row: DatabaseMessage, userId: string): TextMessage | ImageMessage {
  const messageBase = {
    id: row.id,
    fromMe: row.sender_id === userId,
    time: new Date(row.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    createdAt: row.created_at,
  };
  if (row.deleted_at || row.moderation_hidden_at) {
    return { ...messageBase, kind: 'text', text: row.moderation_hidden_at ? 'Image unavailable' : 'Message removed' };
  }
  if (row.attachment_path) {
    return {
      ...messageBase,
      kind: 'image',
      attachmentPath: row.attachment_path,
      ...(row.body.trim() ? { text: row.body } : {}),
    };
  }
  return {
    ...messageBase,
    kind: 'text',
    text: row.body,
  };
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

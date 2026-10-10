import { CONTENT_SAFETY_MESSAGE, isContentSafetyError } from '@/features/safety/contentSafety';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from 'react';

import { isBlockedInteraction } from '@/features/blocking/blockingErrors';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import {
  createOrGetConversation as createOrGetRemoteConversation,
  sendChatImageMessage as sendChatImageRemote,
  fetchConversation,
  fetchConversations,
  fetchMessages,
  fetchUnreadMessageCount,
  markConversationRead,
  sendMessage,
  subscribeToConversationUpdates,
  subscribeToConversationMessages,
  unsubscribeFromConversationUpdates,
  unsubscribeFromMessages,
} from '@/features/messaging/services/messagingRepository';
import type { MarketplaceConversation, MarketplaceMessage } from '@/features/messaging/types/messaging';
import type { Listing } from '@/models';

interface ActionResult {
  error?: string;
  id?: string;
}

export interface ChatImageDraft {
  uploadId: string;
  uri: string;
  bytes: Uint8Array;
  uploadAttempted?: boolean;
}

interface MessagingStoreValue {
  conversations: MarketplaceConversation[];
  drafts: Record<string, string>;
  error: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  messagesLoading: boolean;
  realtimeStatus: string;
  refreshing: boolean;
  sending: boolean;
  unreadCount: number;
  closeConversation: (conversationId: string) => void;
  canLoadOlder: (conversationId: string) => boolean;
  getOrCreateConversation: (listing: Listing) => Promise<ActionResult>;
  loadMore: () => Promise<void>;
  loadOlderMessages: (conversationId: string) => Promise<void>;
  markRead: (conversationId: string) => Promise<void>;
  openConversation: (conversationId: string) => Promise<void>;
  refresh: () => Promise<void>;
  sendText: (conversationId: string) => Promise<ActionResult>;
  sendImage: (conversationId: string, image: ChatImageDraft) => Promise<ActionResult>;
  setDraft: (conversationId: string, value: string) => void;
}

const MessagingStoreContext = createContext<MessagingStoreValue | null>(null);

export function MessagingStoreProvider({ children }: PropsWithChildren) {
  const { initializing, session } = useAuthStore();
  const userId = session?.user.id ?? null;
  const [storedUserId, setStoredUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<MarketplaceConversation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [realtimeStatus, setRealtimeStatus] = useState('CLOSED');
  const pageRef = useRef(0);
  const messagePagesRef = useRef<Record<string, { hasMore: boolean; nextPage: number }>>({});
  const sendLocksRef = useRef(new Set<string>());
  const activeConversationRef = useRef<string | null>(null);
  const subscriptionRef = useRef<RealtimeChannel | null>(null);
  const inboxSubscriptionsRef = useRef<RealtimeChannel[]>([]);
  const inboxRefreshInFlightRef = useRef(false);
  const generationRef = useRef(0);
  const loadRequestRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const olderMessageLocksRef = useRef(new Set<string>());

  const stopSubscription = useCallback(async () => {
    const channel = subscriptionRef.current;
    subscriptionRef.current = null;
    setRealtimeStatus('CLOSED');
    await unsubscribeFromMessages(channel);
  }, []);

  const load = useCallback(async (targetUserId: string, asRefresh = false) => {
    const generation = generationRef.current;
    const request = ++loadRequestRef.current;
    if (asRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [page, unread] = await Promise.all([
        fetchConversations(targetUserId, 0),
        fetchUnreadMessageCount(),
      ]);
      if (
        generation !== generationRef.current
        || request !== loadRequestRef.current
        || targetUserId !== userId
      ) return;
      setStoredUserId(targetUserId);
      setConversations((current) => page.items.map((item) => {
        if (activeConversationRef.current !== item.id) return item;
        const open = current.find((conversation) => conversation.id === item.id);
        return open ? { ...item, messages: open.messages, unread: 0 } : item;
      }));
      setUnreadCount(unread);
      setHasMore(page.hasMore);
      pageRef.current = page.nextPage;
    } catch {
      if (generation === generationRef.current && request === loadRequestRef.current) {
        setError('Conversations could not be loaded. Check your connection and try again.');
      }
    } finally {
      if (generation === generationRef.current && request === loadRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    generationRef.current += 1;
    loadRequestRef.current += 1;
    loadMoreInFlightRef.current = false;
    olderMessageLocksRef.current.clear();
    void stopSubscription();
    void unsubscribeFromConversationUpdates(inboxSubscriptionsRef.current);
    inboxSubscriptionsRef.current = [];
    activeConversationRef.current = null;
    sendLocksRef.current.clear();
    messagePagesRef.current = {};
    setStoredUserId(null);
    setConversations([]);
    setDrafts({});
    setUnreadCount(0);
    setHasMore(false);
    setError(null);
    pageRef.current = 0;
    if (!initializing && userId) {
      void load(userId);
      inboxSubscriptionsRef.current = subscribeToConversationUpdates(userId, () => {
        if (inboxRefreshInFlightRef.current) return;
        inboxRefreshInFlightRef.current = true;
        void load(userId, true).finally(() => {
          inboxRefreshInFlightRef.current = false;
        });
      });
    }
    else setLoading(false);
  }, [initializing, load, stopSubscription, userId]);

  useEffect(() => () => {
    void unsubscribeFromMessages(subscriptionRef.current);
    void unsubscribeFromConversationUpdates(inboxSubscriptionsRef.current);
    subscriptionRef.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (userId) await load(userId, true);
  }, [load, userId]);

  const loadMore = useCallback(async () => {
    if (!userId || storedUserId !== userId || loadMoreInFlightRef.current || !hasMore) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    const generation = generationRef.current;
    try {
      const page = await fetchConversations(userId, pageRef.current);
      if (generation !== generationRef.current) return;
      setConversations((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setHasMore(page.hasMore);
      pageRef.current = page.nextPage;
    } catch {
      if (generation === generationRef.current) {
        setError('More conversations could not be loaded. Try again.');
      }
    } finally {
      loadMoreInFlightRef.current = false;
      if (generation === generationRef.current) setLoadingMore(false);
    }
  }, [hasMore, storedUserId, userId]);

  const appendMessage = useCallback((conversationId: string, message: MarketplaceMessage) => {
    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      if (conversation.messages.some((existing) => existing.id === message.id)) return conversation;
      return {
        ...conversation,
        messages: [...conversation.messages, message],
        unread: message.fromMe || activeConversationRef.current === conversationId
          ? 0
          : conversation.unread + 1,
        updatedAt: message.createdAt ? new Date(message.createdAt).getTime() : Date.now(),
        timeAgo: 'Now',
      };
    }).sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  const markRead = useCallback(async (conversationId: string) => {
    if (!userId) return;
    const currentUnread = conversations.find((item) => item.id === conversationId)?.unread ?? 0;
    setConversations((current) => current.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, unread: 0 } : conversation));
    setUnreadCount((current) => Math.max(0, current - currentUnread));
    try {
      await markConversationRead(conversationId, userId);
    } catch {
      setError('Read status could not be synchronized. It will retry when you refresh.');
    }
  }, [conversations, userId]);

  const openConversation = useCallback(async (conversationId: string) => {
    if (!userId) return;
    activeConversationRef.current = conversationId;
    setMessagesLoading(true);
    setError(null);
    await stopSubscription();
    try {
      const [conversation, page] = await Promise.all([
        fetchConversation(conversationId, userId),
        fetchMessages(conversationId, userId, 0),
      ]);
      if (!conversation || activeConversationRef.current !== conversationId) return;
      messagePagesRef.current[conversationId] = { hasMore: page.hasMore, nextPage: page.nextPage };
      setConversations((current) => {
        const hydrated = { ...conversation, messages: page.items, unread: 0 };
        const others = current.filter((item) => item.id !== conversationId);
        return [hydrated, ...others].sort((a, b) => b.updatedAt - a.updatedAt);
      });
      await markConversationRead(conversationId, userId);
      setUnreadCount(await fetchUnreadMessageCount());
      const channel = await subscribeToConversationMessages(
        conversationId,
        userId,
        (message) => {
          appendMessage(conversationId, message);
          if (!message.fromMe && activeConversationRef.current === conversationId) {
            void markConversationRead(conversationId, userId).then(() => setUnreadCount((count) => Math.max(0, count - 1)));
          }
        },
        (status) => {
          setRealtimeStatus(status);
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setError('Live updates were interrupted. Supabase will retry automatically.');
          }
        },
        (message) => {
          setConversations(current => current.map(item => item.id === conversationId ? {
            ...item, messages: item.messages.map(existing => existing.id === message.id ? message : existing),
          } : item));
        },
      );
      if (activeConversationRef.current === conversationId) subscriptionRef.current = channel;
      else await unsubscribeFromMessages(channel);
    } catch {
      setError('This conversation could not be loaded. It may no longer be available.');
    } finally {
      setMessagesLoading(false);
    }
  }, [appendMessage, stopSubscription, userId]);

  const closeConversation = useCallback((conversationId: string) => {
    if (activeConversationRef.current === conversationId) {
      activeConversationRef.current = null;
      void stopSubscription();
    }
  }, [stopSubscription]);

  const loadOlderMessages = useCallback(async (conversationId: string) => {
    if (!userId || olderMessageLocksRef.current.has(conversationId)) return;
    const state = messagePagesRef.current[conversationId];
    if (!state?.hasMore) return;
    olderMessageLocksRef.current.add(conversationId);
    setMessagesLoading(true);
    const generation = generationRef.current;
    try {
      const page = await fetchMessages(conversationId, userId, state.nextPage);
      if (generation !== generationRef.current) return;
      messagePagesRef.current[conversationId] = { hasMore: page.hasMore, nextPage: page.nextPage };
      setConversations((current) => current.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const existing = new Set(conversation.messages.map((message) => message.id));
        return { ...conversation, messages: [...page.items.filter((message) => !existing.has(message.id)), ...conversation.messages] };
      }));
    } catch {
      if (generation === generationRef.current) {
        setError('Earlier messages could not be loaded. Try again.');
      }
    } finally {
      olderMessageLocksRef.current.delete(conversationId);
      if (generation === generationRef.current) setMessagesLoading(false);
    }
  }, [userId]);

  const setDraft = useCallback((conversationId: string, value: string) => {
    setDrafts((current) => ({ ...current, [conversationId]: value.slice(0, 2000) }));
  }, []);

  const sendText = useCallback(async (conversationId: string): Promise<ActionResult> => {
    const text = drafts[conversationId]?.trim();
    if (!userId) return { error: 'Sign in to send a message.' };
    if (!text) return { error: 'Enter a message before sending.' };
    if (sendLocksRef.current.has(conversationId)) return {};
    sendLocksRef.current.add(conversationId);
    setSending(true);
    try {
      const message = await sendMessage(conversationId, userId, text);
      appendMessage(conversationId, message);
      setDrafts((current) => ({ ...current, [conversationId]: '' }));
      return { id: message.id };
    } catch (failure) {
      if (isContentSafetyError(failure)) {
        setError(CONTENT_SAFETY_MESSAGE);
        return { error: CONTENT_SAFETY_MESSAGE };
      }
      if (isBlockedInteraction(failure)) {
        const message = 'Messaging is unavailable between these accounts. Your draft was kept.';
        setError(message);
        return { error: message };
      }
      setError('Message failed to send. Your draft was kept so you can retry.');
      return { error: 'Message failed to send. Check your connection and try again.' };
    } finally {
      sendLocksRef.current.delete(conversationId);
      setSending(false);
    }
  }, [appendMessage, drafts, userId]);

  const sendImage = useCallback(async (
    conversationId: string,
    image: ChatImageDraft,
  ): Promise<ActionResult> => {
    if (!userId) return { error: 'Sign in to send an image.' };
    if (sendLocksRef.current.has(conversationId)) return {};
    sendLocksRef.current.add(conversationId);
    setSending(true);
    try {
      const message = await sendChatImageRemote(
        conversationId,
        userId,
        image.uploadId,
        image.bytes,
        drafts[conversationId] ?? '',
      );
      appendMessage(conversationId, message);
      setDrafts((current) => ({ ...current, [conversationId]: '' }));
      return { id: message.id };
    } catch (failure) {
      if (isContentSafetyError(failure)) {
        setError(CONTENT_SAFETY_MESSAGE);
        return { error: CONTENT_SAFETY_MESSAGE };
      }
      if (isBlockedInteraction(failure)) {
        const message = 'Messaging is unavailable between these accounts. Your image was kept so you can retry if the block is removed.';
        setError(message);
        return { error: message };
      }
      setError('Image failed to send. Your preview was kept so you can retry.');
      return { error: 'Image failed to send. Check your connection and try again.' };
    } finally {
      sendLocksRef.current.delete(conversationId);
      setSending(false);
    }
  }, [appendMessage, drafts, userId]);

  const getOrCreateConversation = useCallback(async (listing: Listing): Promise<ActionResult> => {
    if (!userId) return { error: 'Sign in to message a seller.' };
    if (listing.seller.id === userId) return { error: 'You cannot message yourself about your own listing.' };
    try {
      const id = await createOrGetRemoteConversation(listing.id, userId, listing.seller.id);
      await load(userId, true);
      return { id };
    } catch {
      return { error: 'This listing is unavailable or can no longer receive new conversations.' };
    }
  }, [load, userId]);

  const visibleConversations = useMemo(
    () => storedUserId === userId ? conversations : [],
    [conversations, storedUserId, userId],
  );
  const canLoadOlder = useCallback(
    (conversationId: string) => Boolean(messagePagesRef.current[conversationId]?.hasMore),
    [],
  );
  const value = useMemo<MessagingStoreValue>(() => ({
    conversations: visibleConversations,
    drafts,
    error,
    hasMore: storedUserId === userId && hasMore,
    loading,
    loadingMore,
    messagesLoading,
    realtimeStatus,
    refreshing,
    sending,
    unreadCount: storedUserId === userId ? unreadCount : 0,
    canLoadOlder,
    closeConversation,
    getOrCreateConversation,
    loadMore,
    loadOlderMessages,
    markRead,
    openConversation,
    refresh,
    sendText,
    sendImage,
    setDraft,
  }), [
    canLoadOlder, closeConversation, drafts, error, getOrCreateConversation, hasMore, loadMore, loading,
    loadingMore, loadOlderMessages, markRead, messagesLoading, openConversation, realtimeStatus,
    refresh, refreshing, sendImage, sendText, sending, setDraft, storedUserId, unreadCount, userId,
    visibleConversations,
  ]);

  return <MessagingStoreContext.Provider value={value}>{children}</MessagingStoreContext.Provider>;
}

export function useMessagingStore() {
  const value = useContext(MessagingStoreContext);
  if (!value) throw new Error('useMessagingStore must be used within MessagingStoreProvider.');
  return value;
}

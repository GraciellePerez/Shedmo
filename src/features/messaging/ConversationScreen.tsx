import { showContentSafetyAlert } from '@/features/safety/showContentSafetyAlert';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlockUserButton } from '@/features/blocking/BlockUserButton';
import { useBlockingStore } from '@/features/blocking/BlockingStore';
import { Avatar } from '@/components/Avatar';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { MessageBubble } from '@/features/messaging/components/MessageBubble';
import { MessageComposer } from '@/features/messaging/components/MessageComposer';
import { createChatUploadId, prepareChatImage } from '@/features/messaging/services/chatImage';
import { discardChatImageUpload } from '@/features/messaging/services/messagingRepository';
import { useMessagingStore } from '@/features/messaging/store/MessagingStore';
import type { ChatImageDraft } from '@/features/messaging/store/MessagingStore';
import type { MarketplaceMessage } from '@/features/messaging/types/messaging';
import { ReportModal } from '@/features/reports/components/ReportModal';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function ConversationScreen({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<MarketplaceMessage>>(null);
  const [reportedMessageId, setReportedMessageId] = useState<string | null>(null);
  const [imageDraft, setImageDraft] = useState<ChatImageDraft | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const store = useMessagingStore();
  const { blockedIds } = useBlockingStore();
  const { profile } = useAuthStore();
  const { closeConversation, openConversation } = store;
  const conversation = store.conversations.find((item) => item.id === conversationId);
  const latestMessageId = conversation?.messages.at(-1)?.id;
  const currentUserName = profile?.display_name?.trim() || profile?.username?.trim() || 'Shedmo User';
  const currentUserInitials = currentUserName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  useEffect(() => {
    void openConversation(conversationId);
    return () => closeConversation(conversationId);
  }, [closeConversation, conversationId, openConversation]);

  useEffect(() => {
    if (!latestMessageId) return;
    const timeout = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timeout);
  }, [latestMessageId]);

  const scrollToNewest = () => listRef.current?.scrollToEnd({ animated: true });

  const send = () => {
    void store.sendText(conversationId).then((result) => {
      if (result.error) {
        if (!showContentSafetyAlert({ message: result.error })) Alert.alert('Message not sent', result.error);
        return;
      }
      scrollToNewest();
    });
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      setPreparingImage(true);
      const prepared = await prepareChatImage(result.assets[0]);
      setImageDraft({ uploadId: createChatUploadId(), ...prepared });
    } catch (failure) {
      Alert.alert(
        'Photo not ready',
        failure instanceof Error ? failure.message : 'The selected photo could not be prepared. Try another photo.',
      );
    } finally {
      setPreparingImage(false);
    }
  };

  const sendImage = () => {
    if (!imageDraft) return;
    const pendingImage = { ...imageDraft, uploadAttempted: true };
    setImageDraft(pendingImage);
    void store.sendImage(conversationId, pendingImage).then((result) => {
      if (result.error) {
        if (!showContentSafetyAlert({ message: result.error })) Alert.alert('Photo not sent', result.error);
        return;
      }
      setImageDraft(null);
      scrollToNewest();
    });
  };

  const discardImage = async () => {
    if (!imageDraft) return;
    try {
      if (imageDraft.uploadAttempted && profile?.id) {
        await discardChatImageUpload(conversationId, profile.id, imageDraft.uploadId);
      }
      setImageDraft(null);
    } catch {
      Alert.alert('Photo not removed', 'The temporary upload could not be cleaned up. Keep the preview and try again.');
    }
  };

  const showMessageActions = (message: MarketplaceMessage) => {
    if (message.fromMe || (message.kind !== 'text' && message.kind !== 'image')) return;
    Alert.alert('Message options', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: () => setReportedMessageId(message.id),
      },
    ]);
  };

  if (!conversation) {
    return (
      <SafeAreaView style={styles.missing}>
        <Ionicons color={colors.textSecondary} name={store.messagesLoading ? 'hourglass-outline' : 'chatbubble-ellipses-outline'} size={42} />
        <Text style={styles.missingTitle}>
          {store.messagesLoading ? 'Loading conversation…' : store.error ?? 'Conversation not found'}
        </Text>
        {!store.messagesLoading ? (
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        style={styles.keyboard}
      >
        <View style={styles.header}>
          <Pressable accessibilityLabel="Back to inbox" hitSlop={10} onPress={() => router.back()} style={styles.headerBack}>
            <Ionicons color={colors.text} name="chevron-back" size={27} />
          </Pressable>
          <Pressable
            accessibilityLabel={`View ${conversation.participant.name}'s profile`}
            onPress={() => router.push({
              pathname: '/sellers/[id]',
              params: { id: conversation.participant.id },
            })}
            style={styles.participant}
          >
            <Avatar
              backgroundColor={conversation.participant.avatarColor}
              imageUri={conversation.participant.avatarUrl}
              initials={conversation.participant.initials}
              size={38}
            />
            <View style={styles.person}>
              <Text numberOfLines={1} style={styles.name}>{conversation.participant.name}</Text>
              <Text style={styles.role}>{conversation.relationship === 'buying' ? 'Seller' : 'Buyer'}</Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel="Conversation options"
            hitSlop={10}
            onPress={() => Alert.alert(
              'Conversation options',
              'Press and hold a received message to report it.',
            )}
            style={styles.headerMenu}
          >
            <Ionicons color={colors.text} name="ellipsis-horizontal" size={23} />
          </Pressable>
        </View>
        <Pressable
          disabled={conversation.listing.unavailable}
          onPress={() => router.push({ pathname: '/listings/[id]', params: { id: conversation.listing.id } })}
          style={styles.listingBar}
        >
          {!conversation.listing.unavailable ? <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            recyclingKey={`conversation-listing:${conversation.listing.id}`}
            source={conversation.listing.image}
            style={styles.listingImage}
          /> : <Ionicons name="image-outline" size={36} color={colors.textMuted} />}
          <View style={styles.listingCopy}>
            <Text numberOfLines={1} style={styles.listingTitle}>{conversation.listing.title}</Text>
            {!conversation.listing.unavailable ? <Text style={styles.listingPrice}>${conversation.listing.price.toLocaleString()}</Text> : null}
          </View>
          {!conversation.listing.unavailable ? <Ionicons color={colors.textMuted} name="chevron-forward" size={18} /> : null}
        </Pressable>
        {conversation.listing.pickup ? <Pressable onPress={() => router.push({ pathname: '/local-sale/[listingId]', params: { listingId: conversation.listing.id } })} style={styles.localSafety}><Text style={styles.localSafetyTitle}>Local sale</Text><Text style={styles.localSafetyCopy}>Arrange payment and pickup directly. Shedmo does not process payments for local sales. View sale status →</Text></Pressable> : null}
        <BlockUserButton userId={conversation.participant.id} />
        <FlatList
          ref={listRef}
          contentContainerStyle={styles.messages}
          data={conversation.messages}
          initialNumToRender={18}
          keyExtractor={(message) => message.id}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            store.canLoadOlder(conversationId) ? <Pressable
              disabled={store.messagesLoading}
              onPress={() => void store.loadOlderMessages(conversationId)}
              style={styles.older}
            >
              <Text style={styles.olderText}>
                {store.messagesLoading ? 'Loading…' : 'Load earlier messages'}
              </Text>
            </Pressable> : null
          }
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatTitle}>Start the conversation</Text>
              <Text style={styles.emptyChatCopy}>Ask about availability, pickup, or the item’s condition.</Text>
            </View>
          }
          renderItem={({ item }) => item.kind === 'text' || item.kind === 'image'
            ? (
              <MessageBubble
                message={item}
                onReport={item.fromMe ? undefined : () => showMessageActions(item)}
                senderAvatar={item.fromMe ? {
                  imageUri: profile?.avatar_url ?? undefined,
                  initials: currentUserInitials,
                } : {
                  backgroundColor: conversation.participant.avatarColor,
                  imageUri: conversation.participant.avatarUrl,
                  initials: conversation.participant.initials,
                }}
              />
            )
            : null}
          showsVerticalScrollIndicator={false}
        />
        {store.error ? <Text style={styles.error}>{store.error}</Text> : null}
        <View style={{ paddingBottom: Math.max(insets.bottom, spacing.sm) }}>
          {blockedIds.has(conversation.participant.id) ? <Text style={styles.error}>You blocked this user. Unblock them to send messages.</Text> : <>
            {imageDraft ? (
              <View style={styles.imageDraft}>
                <Image contentFit="cover" source={{ uri: imageDraft.uri }} style={styles.imageDraftPreview} />
                <View style={styles.imageDraftCopy}>
                  <Text style={styles.imageDraftTitle}>Photo ready to send</Text>
                  <Text style={styles.imageDraftHint}>Preview your photo before sending.</Text>
                </View>
                <Pressable accessibilityLabel="Remove photo preview" hitSlop={8} onPress={() => void discardImage()} style={styles.imageDraftAction}>
                  <Ionicons color={colors.textSecondary} name="close-circle" size={24} />
                </Pressable>
                <Pressable accessibilityLabel="Send photo" disabled={store.sending} onPress={sendImage} style={[styles.imageSend, store.sending && styles.imageSendDisabled]}>
                  <Ionicons color={colors.white} name="arrow-up" size={20} />
                </Pressable>
              </View>
            ) : null}
            <MessageComposer
              onAttach={() => void pickImage()}
              onChangeText={(value) => store.setDraft(conversationId, value)}
              onSend={send}
              sending={store.sending || preparingImage}
              disabled={Boolean(imageDraft) || preparingImage}
              value={store.drafts[conversationId] ?? ''}
            />
            {preparingImage ? <Text style={styles.preparingImage}>Preparing photo…</Text> : null}
          </>}
        </View>
      </KeyboardAvoidingView>
      {reportedMessageId ? (
        <ReportModal
          onClose={() => setReportedMessageId(null)}
          target={{
            type: 'message',
            targetId: reportedMessageId,
            conversationId,
          }}
          visible
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  keyboard: { flex: 1 },
  header: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', minHeight: 58, paddingHorizontal: spacing.md },
  headerBack: { alignItems: 'center', height: 42, justifyContent: 'center', marginRight: spacing.xs, width: 34 },
  headerMenu: { alignItems: 'center', height: 42, justifyContent: 'center', width: 38 },
  person: { flex: 1, marginLeft: 10 },
  participant: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  name: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle },
  role: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginTop: 1 },
  listingBar: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.border, borderTopColor: colors.border, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  listingImage: { borderRadius: 7, height: 44, width: 44 },
  listingCopy: { flex: 1, marginLeft: spacing.md },
  listingTitle: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  listingPrice: { color: colors.primary, fontFamily: fontFamily.bold, fontSize: fontSize.bodySmall, marginTop: spacing.xs },
  localSafety: { backgroundColor: '#FFF6E5', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  localSafetyTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.bodySmall },
  localSafetyCopy: { color: colors.textSecondary, fontSize: fontSize.footnote, lineHeight: 17, marginTop: spacing.xs },
  messages: { flexGrow: 1, justifyContent: 'flex-end', paddingBottom: spacing.md, paddingTop: spacing.sm },
  older: { alignSelf: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  olderText: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.footnote },
  emptyChat: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl },
  emptyChatTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle },
  emptyChatCopy: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 19, marginTop: spacing.sm, textAlign: 'center' },
  error: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, padding: spacing.sm, textAlign: 'center' },
  imageDraft: { alignItems: 'center', backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  imageDraftPreview: { borderRadius: 8, height: 56, width: 56 },
  imageDraftCopy: { flex: 1 },
  imageDraftTitle: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  imageDraftHint: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: 2 },
  imageDraftAction: { alignItems: 'center', height: 40, justifyContent: 'center', width: 32 },
  imageSend: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  imageSendDisabled: { backgroundColor: colors.textMuted },
  preparingImage: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  missing: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xxl },
  missingTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.md, textAlign: 'center' },
  backButton: { backgroundColor: colors.primary, borderRadius: 12, marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  backButtonText: { color: colors.white, fontFamily: fontFamily.semibold, fontSize: fontSize.body },
});

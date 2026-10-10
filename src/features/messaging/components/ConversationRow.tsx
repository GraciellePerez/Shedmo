import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import type {
  MarketplaceConversation,
  MarketplaceMessage,
} from '@/features/messaging/types/messaging';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: MarketplaceConversation;
  onPress: () => void;
}) {
  const latest = conversation.messages.at(-1);

  return (
    <Pressable
      accessibilityLabel={`Conversation with ${conversation.participant.name} about ${conversation.listing.title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Avatar
        backgroundColor={conversation.participant.avatarColor}
        imageUri={conversation.participant.avatarUrl}
        initials={conversation.participant.initials}
        size={50}
      />
      <View style={styles.content}>
        <View style={styles.topLine}>
          <Text
            numberOfLines={1}
            style={[styles.name, conversation.unread > 0 && styles.unreadName]}
          >
            {conversation.participant.name}
          </Text>
          <Text style={styles.time}>{conversation.timeAgo}</Text>
        </View>
        <View style={styles.listingLine}>
          <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            recyclingKey={`inbox-listing:${conversation.listing.id}`}
            source={conversation.listing.image}
            style={styles.thumbnail}
          />
          <Text numberOfLines={1} style={styles.listingTitle}>{conversation.listing.title}</Text>
        </View>
        <View style={styles.messageLine}>
          <Text
            numberOfLines={1}
            style={[styles.latest, conversation.unread > 0 && styles.unreadLatest]}
          >
            {latestMessage(latest)}
          </Text>
          {conversation.unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{conversation.unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function latestMessage(message?: MarketplaceMessage) {
  if (!message) return 'Start the conversation';
  if (message.kind === 'text') return `${message.fromMe ? 'You: ' : ''}${message.text}`;
  if (message.kind === 'image') return `${message.fromMe ? 'You: ' : ''}Photo`;
  return `${message.fromMe ? 'You sent' : 'Received'} a $${message.offer.amount} offer`;
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
  },
  pressed: { backgroundColor: colors.background },
  content: { flex: 1, minWidth: 0 },
  topLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  name: { color: colors.text, flex: 1, fontFamily: fontFamily.semibold, fontSize: fontSize.body },
  unreadName: { fontFamily: fontFamily.bold },
  time: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginLeft: spacing.sm },
  listingLine: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.xs },
  thumbnail: { borderRadius: 4, height: 22, marginRight: 6, width: 22 },
  listingTitle: { color: colors.primary, flex: 1, fontFamily: fontFamily.semibold, fontSize: fontSize.footnote },
  messageLine: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.xs },
  latest: { color: colors.textSecondary, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall },
  unreadLatest: { color: colors.text, fontFamily: fontFamily.medium },
  badge: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 10, height: 20, justifyContent: 'center', marginLeft: spacing.sm, minWidth: 20, paddingHorizontal: 5 },
  badgeText: { color: colors.white, fontFamily: fontFamily.extraBold, fontSize: fontSize.caption },
});

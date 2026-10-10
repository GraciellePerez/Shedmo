import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { ChatImageAttachment } from '@/features/messaging/components/ChatImageAttachment';
import type { ImageMessage, TextMessage } from '@/features/messaging/types/messaging';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function MessageBubble({
  message,
  onReport,
  senderAvatar,
}: {
  message: TextMessage | ImageMessage;
  onReport?: () => void;
  senderAvatar: { backgroundColor?: string; imageUri?: string; initials: string };
}) {
  const avatar = (
    <Avatar
      backgroundColor={senderAvatar.backgroundColor}
      imageUri={senderAvatar.imageUri}
      initials={senderAvatar.initials}
      size={30}
    />
  );

  return (
    <Pressable
      accessibilityHint={onReport ? 'Press and hold for message options' : undefined}
      delayLongPress={450}
      onLongPress={onReport}
      style={[styles.row, message.fromMe ? styles.sentRow : styles.receivedRow]}
    >
      {!message.fromMe ? avatar : null}
      <View style={message.kind === 'image' ? styles.imageBubble : [styles.bubble, message.fromMe ? styles.sent : styles.received]}>
        {message.kind === 'image' ? (
          <ChatImageAttachment path={message.attachmentPath} time={message.time} />
        ) : null}
        {message.kind === 'text' || message.text ? (
          <Text style={[styles.copy, message.kind === 'text' && message.fromMe && styles.sentCopy]}>
            {message.kind === 'text' ? message.text : message.text}
          </Text>
        ) : null}
        {message.kind === 'text' ? <Text style={[styles.time, message.fromMe && styles.sentTime]}>{message.time}</Text> : null}
      </View>
      {message.fromMe ? avatar : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-end', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  sentRow: { justifyContent: 'flex-end' },
  receivedRow: { justifyContent: 'flex-start' },
  bubble: { borderRadius: radii.lg, maxWidth: '76%', minWidth: 72, overflow: 'hidden', paddingHorizontal: 13, paddingVertical: 9 },
  imageBubble: { maxWidth: '76%' },
  sent: { backgroundColor: colors.text, borderBottomRightRadius: 4 },
  received: { backgroundColor: colors.border, borderBottomLeftRadius: 4 },
  copy: { color: colors.text, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 21 },
  sentCopy: { color: colors.white },
  time: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: 5, textAlign: 'right' },
  sentTime: { color: 'rgba(255,255,255,0.65)' },
});

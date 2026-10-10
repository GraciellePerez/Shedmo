import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function MessageComposer({
  value,
  onAttach,
  onChangeText,
  onSend,
  sending = false,
  disabled = false,
}: {
  value: string;
  onAttach: () => void;
  onChangeText: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
}) {
  const canSend = value.trim().length > 0;
  return (
    <View style={styles.container}>
      <Pressable accessibilityLabel="Attach image" disabled={disabled || sending} hitSlop={8} onPress={onAttach} style={styles.attach}>
        <Ionicons color={colors.text} name="image-outline" size={23} />
      </Pressable>
      <TextInput
        multiline
        onChangeText={onChangeText}
        placeholder="Message..."
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
        value={value}
      />
      <Pressable
        accessibilityLabel="Send message"
        disabled={!canSend || sending}
        onPress={onSend}
        style={[styles.send, (!canSend || sending) && styles.sendDisabled]}
      >
        <Ionicons color={colors.white} name="arrow-up" size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-end', backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  attach: { alignItems: 'center', height: 40, justifyContent: 'center', width: 36 },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 20, borderWidth: 1, color: colors.text, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.body, maxHeight: 108, minHeight: 40, paddingHorizontal: 14, paddingVertical: 9 },
  send: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  sendDisabled: { backgroundColor: colors.textMuted },
});

import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { colors, fontFamily, spacing } from '@/theme';
import { useBlockingStore } from './BlockingStore';

export function BlockUserButton({ userId }: { userId: string }) {
  const { user } = useAuthStore();
  const { blockedIds, pending, setBlocked } = useBlockingStore();
  if (!userId || user?.id === userId) return null;
  const blocked = blockedIds.has(userId);
  const label = blocked ? 'Unblock user' : 'Block user';
  return <Pressable accessibilityRole="button" disabled={pending} style={styles.button} onPress={() => Alert.alert(
    blocked ? 'Unblock this user?' : 'Block this user?',
    blocked
      ? 'Their listings can appear again. Messaging can resume unless the other user has also blocked you.'
      : "You won't see their listings in discovery or Saved Items. Neither of you can send new messages to the other. Existing conversations and transaction records remain available.",
    [{ text: 'Cancel', style: 'cancel' }, { text: blocked ? 'Unblock' : 'Block', style: 'destructive', onPress: () => {
      void setBlocked(userId, !blocked).then(error => { if (error) Alert.alert('Unable to update blocking', error); });
    } }],
  )}><Text style={styles.text}>{pending ? 'Updating…' : label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 44, justifyContent: 'center', padding: spacing.sm },
  text: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: 16 },
});

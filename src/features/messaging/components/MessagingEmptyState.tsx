import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { ConversationFilter } from '@/features/messaging/types/messaging';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function MessagingEmptyState({ filter }: { filter: ConversationFilter }) {
  return (
    <View style={styles.container}>
      <View style={styles.icon}>
        <Ionicons color={colors.textSecondary} name="mail-open-outline" size={34} />
      </View>
      <Text style={styles.title}>
        {filter === 'all' ? 'No conversations yet' : `No ${filter} messages`}
      </Text>
      <Text style={styles.body}>When you buy or sell, marketplace conversations appear here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingHorizontal: spacing.xxxl, paddingTop: 80 },
  icon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.round, height: 68, justifyContent: 'center', width: 68 },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.lg },
  body: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.sm, textAlign: 'center' },
});

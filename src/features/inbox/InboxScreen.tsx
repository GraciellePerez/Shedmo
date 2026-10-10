import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationRow } from '@/features/messaging/components/ConversationRow';
import { InboxFilter } from '@/features/messaging/components/InboxFilter';
import { MessagingEmptyState } from '@/features/messaging/components/MessagingEmptyState';
import { useMessagingStore } from '@/features/messaging/store/MessagingStore';
import type { ConversationFilter } from '@/features/messaging/types/messaging';
import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function InboxScreen() {
  const router = useRouter();
  const {
    conversations, error, hasMore, loadMore, loading, loadingMore, refresh, refreshing,
  } = useMessagingStore();
  const [filter, setFilter] = useState<ConversationFilter>('all');

  const filtered = useMemo(
    () => filter === 'all'
      ? conversations
      : conversations.filter((conversation) => conversation.relationship === filter),
    [conversations, filter],
  );

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Inbox</Text>
        <InboxFilter onChange={setFilter} value={filter} />
      </View>
      <FlatList
        contentContainerStyle={[styles.content, !filtered.length && styles.emptyContent]}
        data={filtered}
        keyExtractor={(conversation) => conversation.id}
        ListEmptyComponent={
          loading ? (
            <View style={styles.status}>
              <Text style={styles.statusTitle}>Loading conversations…</Text>
            </View>
          ) : error ? (
            <View style={styles.status}>
              <Text style={styles.statusTitle}>Inbox unavailable</Text>
              <Text style={styles.statusBody}>{error}</Text>
              <Pressable onPress={() => void refresh()} style={styles.retry}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : <MessagingEmptyState filter={filter} />
        }
        ListFooterComponent={loadingMore ? <Text style={styles.footer}>Loading more…</Text> : null}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.5}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        renderItem={({ item }) => (
          <ConversationRow
            conversation={item}
            onPress={() => router.push({
              pathname: '/conversations/[id]',
              params: { id: item.id },
            })}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  header: { backgroundColor: colors.surface, paddingBottom: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.xs },
  title: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.display, letterSpacing: -0.5, marginBottom: spacing.md },
  content: { backgroundColor: colors.background, flexGrow: 1, paddingTop: spacing.md },
  emptyContent: { paddingTop: 0 },
  status: { alignItems: 'center', padding: spacing.xxxl },
  statusTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title },
  statusBody: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, marginTop: spacing.sm, textAlign: 'center' },
  retry: { backgroundColor: colors.primary, borderRadius: 12, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.bodySmall },
  footer: { color: colors.textSecondary, fontFamily: fontFamily.medium, padding: spacing.lg, textAlign: 'center' },
});

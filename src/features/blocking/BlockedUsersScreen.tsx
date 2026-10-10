import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, spacing } from '@/theme';
import { useBlockingStore } from './BlockingStore';
import { BlockUserButton } from './BlockUserButton';

export function BlockedUsersScreen() {
  const { users, error, loading, refresh } = useBlockingStore();
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return <SafeAreaView style={styles.safe}>
    <ScreenHeader title="Blocked Users" />
    <FlatList data={users} keyExtractor={item => item.blocked_user_id} contentContainerStyle={styles.content}
      refreshing={loading} onRefresh={() => void refresh()}
      ListHeaderComponent={error ? <Pressable onPress={() => void refresh()}><Text style={styles.text}>{error} Tap to retry.</Text></Pressable> : null}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} /> : !error ? <Text style={styles.text}>You haven&apos;t blocked anyone.</Text> : null}
      renderItem={({ item }) => <View style={styles.row}>
        <Text style={styles.name}>{item.profile?.display_name || item.profile?.username || 'Shedmo user'}</Text>
        <BlockUserButton userId={item.blocked_user_id} />
      </View>} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  name: { flex: 1, color: colors.text, fontFamily: fontFamily.semibold, fontSize: 16 },
  text: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 24 },
});

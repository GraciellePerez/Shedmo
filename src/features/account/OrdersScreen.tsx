import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountEmptyState } from '@/features/account/components/AccountEmptyState';
import { AccountTabs } from '@/features/account/components/AccountTabs';
import { OrderCard } from '@/features/account/components/OrderCard';
import type { OrderRole, OrderState } from '@/features/account/types/account';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { fetchOrders } from '@/features/checkout/checkoutRepository';
import type { MarketplaceOrderRow } from '@/features/checkout/types';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, spacing } from '@/theme';

const tabs: { label: string; value: OrderState }[] = [
  { label: 'Active', value: 'active' }, { label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' },
];

export function OrdersScreen({ role = 'buyer' }: { role?: OrderRole }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<OrderState>('active');
  const [orders, setOrders] = useState<MarketplaceOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (nextPage = 0) => {
    if (!user) return;
    setError(false);
    if (nextPage === 0) setLoading(true);
    try {
      const result = await fetchOrders(role, user.id, nextPage);
      setOrders((current) => nextPage === 0 ? result.items : [...current, ...result.items]);
      setHasMore(result.hasMore); setPage(nextPage);
    } catch { setError(true); } finally { setLoading(false); }
  }, [role, user]);

  useEffect(() => { void load(); }, [load]);
  const items = useMemo(() => orders.filter((order) => classify(order) === tab), [orders, tab]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title={role === 'buyer' ? 'Purchases' : 'Sales'} />
      <AccountTabs items={tabs} onChange={setTab} value={tab} />
      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : <FlatList
        contentContainerStyle={[styles.content, !items.length && styles.emptyContent]}
        data={items} keyExtractor={(item) => item.id}
        onRefresh={() => void load()} refreshing={loading}
        onEndReached={() => { if (hasMore) void load(page + 1); }}
        ListEmptyComponent={error
          ? <Pressable onPress={() => void load()}><Text style={styles.retry}>Orders could not be loaded. Tap to retry.</Text></Pressable>
          : <AccountEmptyState body={`You have no ${tab} ${role === 'buyer' ? 'purchases' : 'sales'}.`} title={`No ${tab} orders`} />}
        renderItem={({ item }) => <OrderCard order={item} onOpen={() => router.push({ pathname: '/orders/[id]', params: { id: item.id } })} />}
      />}
    </SafeAreaView>
  );
}

function classify(order: MarketplaceOrderRow): OrderState {
  if (['failed', 'canceled'].includes(order.payment_status) || order.fulfillment_status === 'canceled') return 'cancelled';
  if (order.fulfillment_status === 'completed') return 'completed';
  return 'active';
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 }, loader: { flex: 1 },
  content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxxl },
  emptyContent: { justifyContent: 'center' }, retry: { color: colors.primary, fontFamily: fontFamily.semibold, textAlign: 'center' },
});

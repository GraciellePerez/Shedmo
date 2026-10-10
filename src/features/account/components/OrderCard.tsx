import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MarketplaceOrderRow } from '@/features/checkout/types';
import { colors, fontFamily, fontSize, radii, shadows, spacing } from '@/theme';

export function OrderCard({ order, onOpen }: { order: MarketplaceOrderRow; onOpen: () => void }) {
  const successful = order.payment_status === 'succeeded';
  const canceled = ['failed', 'canceled'].includes(order.payment_status);
  const color = successful ? colors.success : canceled ? colors.textSecondary : colors.info;
  return (
    <Pressable onPress={onOpen} style={[styles.card, shadows.card]}>
      {order.listing_image_url ? <Image accessibilityLabel={`${order.listing_title_snapshot} listing photo`} cachePolicy="memory-disk" contentFit="cover" source={order.listing_image_url} style={styles.image} /> : <View style={[styles.image, styles.placeholder]}><Ionicons color={colors.textMuted} name="cube-outline" size={28} /></View>}
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.title}>{order.listing_title_snapshot}</Text>
        <Text style={styles.price}>${(Number(order.total_amount) / 100).toFixed(2)}</Text>
        <View style={[styles.status, { backgroundColor: `${color}18` }]}><Text style={[styles.statusText, { color }]}>{formatStatus(order)}</Text></View>
        <Text style={styles.meta}>{order.fulfillment_type === 'shipping' ? 'Shipping' : 'Local pickup'} · {new Date(order.created_at).toLocaleDateString()}</Text>
      </View>
    </Pressable>
  );
}

function formatStatus(order: MarketplaceOrderRow) {
  if (order.payment_status !== 'succeeded') return order.payment_status.replaceAll('_', ' ');
  return order.fulfillment_status.replaceAll('_', ' ');
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, flexDirection: 'row', marginBottom: spacing.md, padding: spacing.md },
  image: { borderRadius: radii.md, height: 92, width: 92 }, placeholder: { alignItems: 'center', backgroundColor: colors.background, justifyContent: 'center' },
  copy: { flex: 1, marginLeft: spacing.md }, title: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.body },
  price: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.subtitle, marginTop: spacing.xs },
  status: { alignSelf: 'flex-start', borderRadius: radii.round, marginTop: spacing.xs, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontFamily: fontFamily.bold, fontSize: fontSize.caption, textTransform: 'capitalize' },
  meta: { color: colors.textSecondary, fontSize: fontSize.footnote, marginTop: spacing.xs },
});

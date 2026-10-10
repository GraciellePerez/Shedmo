import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchOrder } from './checkoutRepository';
import type { MarketplaceOrderRow } from './types';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

const money = (value: number) => `$${(Number(value) / 100).toFixed(2)}`;

export function OrderConfirmationScreen({ orderId, confirmation = true }: { orderId: string; confirmation?: boolean }) {
  const router = useRouter();
  const [order, setOrder] = useState<MarketplaceOrderRow | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { void fetchOrder(orderId).then(setOrder).catch(() => setError(true)); }, [orderId]);
  if (error) return <SafeAreaView style={styles.center}><Text>Order confirmation could not be loaded.</Text></SafeAreaView>;
  if (!order) return <SafeAreaView style={styles.center}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  return <SafeAreaView style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.test}>STRIPE TEST MODE</Text><Text style={styles.title}>{confirmation ? 'Order confirmed' : 'Order details'}</Text>
    <Text style={styles.id}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>
    <View style={styles.card}><Text style={styles.heading}>{order.listing_title_snapshot}</Text>
      <Line label="Item" value={money(order.item_amount)} /><Line label="Shipping" value={money(order.shipping_amount)} />
      <Line label="Tax" value={money(order.tax_amount)} /><Line label="Total" value={money(order.total_amount)} />
      <Line label="Fulfillment" value={order.fulfillment_type === 'pickup' ? 'Local pickup' : 'Seller shipping'} />
      <Line label="Payment" value={order.payment_status} />
    </View>
    <Text style={styles.note}>{order.fulfillment_type === 'pickup'
      ? 'Coordinate pickup with the seller. Your QR code and backup PIN appear after the seller marks the order ready.'
      : 'The seller will add carrier and tracking details when your order ships.'}</Text>
    <Pressable onPress={() => router.replace('/purchases')} style={styles.button}><Text style={styles.buttonText}>View Purchases</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
function Line({ label, value }: { label: string; value: string }) { return <View style={styles.line}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>; }
const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 }, center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl }, test: { color: colors.warning, fontFamily: fontFamily.bold, fontSize: fontSize.caption },
  title: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 28, marginTop: spacing.md }, id: { color: colors.textSecondary, marginTop: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, marginTop: spacing.xl, padding: spacing.lg }, heading: { fontFamily: fontFamily.bold, fontSize: fontSize.subtitle, marginBottom: spacing.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }, label: { color: colors.textSecondary }, value: { color: colors.text, fontFamily: fontFamily.semibold, textTransform: 'capitalize' },
  note: { color: colors.textSecondary, lineHeight: 21, marginTop: spacing.lg }, button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, marginTop: spacing.xl, padding: spacing.md }, buttonText: { color: colors.white, fontFamily: fontFamily.bold },
});

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccountStore } from '@/features/account/store/AccountStore';
import { useListingStore } from '@/features/listings/store/ListingStore';
import { useMessagingStore } from '@/features/messaging/store/MessagingStore';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, fontSize, radii, shadows, spacing } from '@/theme';

export function OrderDetailsScreen({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { orders } = useAccountStore();
  const { listings } = useListingStore();
  const { getOrCreateConversation } = useMessagingStore();
  const order = orders.find((item) => item.id === orderId);
  const listing = listings.find((item) => item.id === order?.listingId);

  if (!order || !listing) return <SafeAreaView style={styles.missing}><Text style={styles.heading}>Order not found</Text></SafeAreaView>;
  const total = order.price + order.shippingCost + order.serviceFee;
  const sellerName = listing.seller.name;
  const buyerName = order.role === 'seller' ? order.otherPartyName : 'Jake Reynolds';
  const steps = order.state === 'cancelled'
    ? ['Order placed', 'Order cancelled']
    : order.deliveryMethod === 'pickup'
      ? ['Order placed', 'Pickup arranged', order.state === 'completed' ? 'Picked up' : 'Awaiting pickup']
      : ['Order placed', 'Seller preparing item', order.state === 'completed' ? 'Delivered' : 'In transit', ...(order.state === 'completed' ? [] : ['Delivery pending'])];

  const message = async () => {
    const result = await getOrCreateConversation(listing);
    if (result.id) router.push({ pathname: '/conversations/[id]', params: { id: result.id } });
    else Alert.alert('Conversation unavailable', result.error ?? 'Try again.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="Order Details" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusCard}>
          <View style={styles.statusIcon}><Ionicons color={colors.white} name={order.state === 'cancelled' ? 'close' : 'cube'} size={23} /></View>
          <View><Text style={styles.status}>{order.status}</Text><Text style={styles.orderId}>Order #{order.id}</Text></View>
        </View>
        <View style={styles.card}>
          <Image contentFit="cover" source={listing.image} style={styles.image} />
          <View style={styles.itemCopy}><Text style={styles.itemTitle}>{listing.title}</Text><Text style={styles.price}>${order.price.toLocaleString()}</Text></View>
        </View>
        <Section title="People">
          <Detail label="Buyer" value={buyerName} />
          <Detail label="Seller" value={sellerName} />
        </Section>
        <Section title="Price Breakdown">
          <Detail label="Item" value={`$${order.price.toLocaleString()}`} />
          <Detail label="Shipping" value={order.shippingCost ? `$${order.shippingCost}` : 'Free'} />
          <Detail label="Service fee" value={`$${order.serviceFee}`} />
          <View style={styles.total}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>${total.toLocaleString()}</Text></View>
        </Section>
        <Section title="Delivery">
          <Detail label="Method" value={order.deliveryMethod === 'shipping' ? 'Nationwide shipping' : 'Local pickup'} />
          {order.deliveryMethod === 'shipping' ? <Detail label="Address" value="123 Market St, Austin, TX 78701" /> : <Detail label="Meetup" value="Location arranged in messages" />}
          {order.trackingNumber ? <Detail label={order.carrier ?? 'Tracking'} value={order.trackingNumber} /> : null}
        </Section>
        <Section title="Order Timeline">
          {steps.map((step, index) => (
            <View key={step} style={styles.timeline}>
              <View style={[styles.timelineDot, index === steps.length - 1 && styles.timelineCurrent]} />
              <Text style={styles.timelineText}>{step}</Text>
            </View>
          ))}
        </Section>
        <Pressable onPress={() => void message()} style={styles.primary}><Ionicons color={colors.white} name="chatbubble-outline" size={18} /><Text style={styles.primaryText}>Message {order.role === 'buyer' ? 'Seller' : 'Buyer'}</Text></Pressable>
        <Pressable onPress={() => Alert.alert(order.state === 'active' ? 'Cancellation request' : 'Order support', 'Support and cancellation are placeholders in this prototype.')} style={styles.secondary}>
          <Text style={styles.secondaryText}>{order.state === 'active' ? 'Request Cancellation' : 'Get Order Support'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.section}><Text style={styles.heading}>{title}</Text>{children}</View>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, padding: spacing.lg, paddingBottom: spacing.xxxl },
  statusCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md, padding: spacing.lg, ...shadows.card },
  statusIcon: { alignItems: 'center', backgroundColor: colors.info, borderRadius: radii.round, height: 46, justifyContent: 'center', width: 46 },
  status: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.subtitle },
  orderId: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginTop: 3 },
  card: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, flexDirection: 'row', marginBottom: spacing.md, padding: spacing.md },
  image: { borderRadius: radii.md, height: 72, width: 72 },
  itemCopy: { flex: 1, marginLeft: spacing.md },
  itemTitle: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.body, lineHeight: 20 },
  price: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.subtitle, marginTop: spacing.xs },
  section: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.md, padding: spacing.lg },
  heading: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body, marginBottom: spacing.md },
  detail: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 31 },
  detailLabel: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall },
  detailValue: { color: colors.text, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, maxWidth: '62%', textAlign: 'right' },
  total: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.md },
  totalLabel: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  totalValue: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.body },
  timeline: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 34 },
  timelineDot: { backgroundColor: colors.success, borderRadius: 6, height: 12, width: 12 },
  timelineCurrent: { backgroundColor: colors.info },
  timelineText: { color: colors.text, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall },
  primary: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 52 },
  primaryText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  secondary: { alignItems: 'center', borderColor: colors.border, borderRadius: 14, borderWidth: 1.5, justifyContent: 'center', marginTop: spacing.md, minHeight: 50 },
  secondaryText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  missing: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' },
});

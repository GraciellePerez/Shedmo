import { useStripe } from '@stripe/stripe-react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { useListingStore } from '@/features/listings/store/ListingStore';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';
import { fetchOrder, initializeCheckout } from './checkoutRepository';
import { stripeConfigurationError } from './stripeConfig';
import type { CheckoutInitialization, FulfillmentType, ShippingDestinationInput } from './types';
import { telemetry } from '@/services/telemetry';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { validateShippingDestination } from './shippingPolicy';
import { PROTECTED_CHECKOUT_ENABLED } from '@/config/launchFeatures';

const cents = (value: number) => `$${(value / 100).toFixed(2)}`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const createCheckoutKey = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (digit) => {
  const random = Math.floor(Math.random() * 16);
  return (digit === 'x' ? random : (random & 0x3) | 0x8).toString(16);
});

export function CheckoutScreen({ listingId, requestedFulfillment }: { listingId: string; requestedFulfillment?: FulfillmentType }) {
  if (!PROTECTED_CHECKOUT_ENABLED) {
    return <ConfigurationUnavailable message="Public V1 is local pickup only. Message the seller to arrange a meetup and pay directly after inspection." />;
  }
  if (stripeConfigurationError) {
    return <ConfigurationUnavailable message={stripeConfigurationError} />;
  }
  return <ConfiguredCheckoutScreen listingId={listingId} requestedFulfillment={requestedFulfillment} />;
}

function ConfiguredCheckoutScreen({ listingId, requestedFulfillment }: { listingId: string; requestedFulfillment?: FulfillmentType }) {
  const router = useRouter();
  const { profile } = useAuthStore();
  const { getListingById } = useListingStore();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [method, setMethod] = useState<FulfillmentType | null>(null);
  const [available, setAvailable] = useState<FulfillmentType[]>([]);
  const [checkout, setCheckout] = useState<CheckoutInitialization | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [clientCheckoutKey] = useState(createCheckoutKey);
  const [destination, setDestination] = useState<ShippingDestinationInput>(() => ({
    recipientName: profile?.display_name?.trim() ?? '',
    addressLine1: '',
    addressLine2: '',
    city: profile?.city?.trim() ?? '',
    region: profile?.state?.trim().toUpperCase() ?? '',
    postalCode: profile?.postal_code?.trim() ?? '',
    countryCode: 'US',
  }));

  useEffect(() => {
    let active = true;
    void getListingById(listingId).then((listing) => {
      if (!active) return;
      const methods: FulfillmentType[] = [];
      if (listing?.pickup) methods.push('pickup');
      if (listing?.shipping) methods.push('shipping');
      setAvailable(methods);
      if (requestedFulfillment && !methods.includes(requestedFulfillment)) {
        setMethod(null);
        setMessage(requestedFulfillment === 'shipping' ? 'Shipping is no longer available for this listing.' : 'This fulfillment option is no longer available.');
      } else {
        setMethod(requestedFulfillment ?? (methods.length === 1 ? methods[0] : null));
      }
      setLoading(false);
    }).catch(() => { if (active) { setMessage('This listing is no longer available.'); setLoading(false); } });
    return () => { active = false; };
  }, [getListingById, listingId, requestedFulfillment]);

  const prepare = useCallback(async () => {
    if (!method || paying) return;
    setPaying(true);
    setMessage(null);
    try {
      if (method === 'shipping') {
        const destinationError = validateShippingDestination(destination);
        if (destinationError) { setMessage(destinationError); return; }
      }
      const result = await initializeCheckout(
        listingId, method, clientCheckoutKey, method === 'shipping' ? destination : undefined,
      );
      if (new Date(result.reservationExpiresAt).getTime() <= Date.now()) throw new Error('EXPIRED');
      const initialized = await initPaymentSheet({
        merchantDisplayName: 'Shedmo',
        paymentIntentClientSecret: result.paymentIntentClientSecret,
        allowsDelayedPaymentMethods: false,
      });
      if (initialized.error) throw new Error('PAYMENT_SHEET_INIT');
      setCheckout(result);
    } catch (error) {
      telemetry.track('checkout_failed', 'listing', listingId, { result_status: 'initialization_failed' });
      telemetry.recordError(error, { operation: 'checkout_prepare', screen: 'checkout' });
      setMessage('Checkout could not be started. The listing may no longer be available.');
    } finally { setPaying(false); }
  }, [clientCheckoutKey, destination, initPaymentSheet, listingId, method, paying]);

  const pay = useCallback(async () => {
    if (!checkout || paying) return;
    if (new Date(checkout.reservationExpiresAt).getTime() <= Date.now()) {
      setMessage('Checkout expired. Please try again.');
      return;
    }
    setPaying(true);
    setMessage(null);
    telemetry.track('checkout_payment_sheet_opened', 'order', checkout.orderId);
    const result = await presentPaymentSheet();
    if (result.error) {
      telemetry.track('checkout_failed', 'order', checkout.orderId, { result_status: result.error.code === 'Canceled' ? 'canceled' : 'failed' });
      setMessage(result.error.code === 'Canceled' ? 'Payment was canceled.' : 'Payment could not be completed.');
      setPaying(false);
      return;
    }
    setMessage('Payment received. Confirming your order…');
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const order = await fetchOrder(checkout.orderId);
        if (order.payment_status === 'succeeded') {
          telemetry.track('protected_checkout_completed', 'order', order.id, { fulfillment_type: order.fulfillment_type });
          router.replace({ pathname: '/orders/confirmation/[id]', params: { id: order.id } });
          return;
        }
        if (order.payment_status === 'failed' || order.payment_status === 'canceled') {
          setMessage('Payment could not be completed.');
          setPaying(false);
          return;
        }
      } catch { /* A transient read failure is retried within the bounded confirmation window. */ }
      await wait(1500);
    }
    setMessage('We’re still confirming your payment. Check Purchases shortly.');
    setPaying(false);
  }, [checkout, paying, presentPaymentSheet, router]);

  if (loading) return <Centered text="Loading checkout…" />;
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="Checkout" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.testMode}>STRIPE TEST MODE</Text>
        {available.length > 1 && !requestedFulfillment && !checkout ? <View style={styles.card}>
          <Text style={styles.heading}>Fulfillment</Text>
          {available.map((item) => <Pressable key={item} onPress={() => setMethod(item)} style={[styles.choice, method === item && styles.choiceSelected]}>
            <Text style={styles.choiceText}>{item === 'pickup' ? 'Local pickup' : 'Seller-managed shipping'}</Text>
          </Pressable>)}
        </View> : null}
        {method === 'shipping' && !checkout ? <View style={styles.card}>
          <Text style={styles.heading}>Protected shipping destination</Text>
          <Text style={styles.note}>Structurally checked by Shedmo, not yet carrier verified. This address freezes when checkout starts.</Text>
          <DestinationInput label="Recipient name" onChangeText={(value) => setDestination((current) => ({ ...current, recipientName: value }))} value={destination.recipientName} />
          <DestinationInput label="Address line 1" onChangeText={(value) => setDestination((current) => ({ ...current, addressLine1: value }))} value={destination.addressLine1} />
          <DestinationInput label="Address line 2 (optional)" onChangeText={(value) => setDestination((current) => ({ ...current, addressLine2: value }))} value={destination.addressLine2} />
          <DestinationInput label="City" onChangeText={(value) => setDestination((current) => ({ ...current, city: value }))} value={destination.city} />
          <View style={styles.destinationRow}>
            <View style={styles.destinationState}><DestinationInput autoCapitalize="characters" label="State" maxLength={2} onChangeText={(value) => setDestination((current) => ({ ...current, region: value.toUpperCase() }))} value={destination.region} /></View>
            <View style={styles.destinationZip}><DestinationInput keyboardType="numbers-and-punctuation" label="ZIP code" maxLength={10} onChangeText={(value) => setDestination((current) => ({ ...current, postalCode: value }))} value={destination.postalCode} /></View>
          </View>
          <Text style={styles.country}>United States only</Text>
        </View> : null}
        {checkout ? <View style={styles.card}>
          <Text style={styles.heading}>{checkout.summary.title}</Text>
          <Line label="Item" value={cents(checkout.summary.itemAmount)} />
          <Line label="Shipping" value={checkout.summary.shippingAmount ? cents(checkout.summary.shippingAmount) : 'Free'} />
          <Line label="Buyer fee" value="$0.00" />
          <Line label="Tax" value={cents(checkout.summary.taxAmount)} />
          <View style={styles.total}><Text style={styles.totalText}>Total</Text><Text style={styles.totalText}>{cents(checkout.summary.totalAmount)}</Text></View>
          <Text style={styles.note}>Taxes are not enabled in this test-only phase.</Text>
        </View> : null}
        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        <Pressable disabled={!method || paying} onPress={() => void (checkout ? pay() : prepare())} style={[styles.primary, (!method || paying) && styles.disabled]}>
          {paying ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>{checkout ? `Pay ${cents(checkout.summary.totalAmount)}` : 'Review server total'}</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Line({ label, value }: { label: string; value: string }) { return <View style={styles.line}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>; }
function DestinationInput({ label, ...props }: ComponentProps<typeof TextInput> & { label: string }) { return <View style={styles.destinationField}><Text style={styles.destinationLabel}>{label}</Text><TextInput autoCapitalize="words" style={styles.destinationInput} {...props} /></View>; }
function Centered({ text }: { text: string }) { return <SafeAreaView style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.message}>{text}</Text></SafeAreaView>; }
function ConfigurationUnavailable({ message }: { message: string }) { return <SafeAreaView style={styles.center}><Text style={styles.heading}>Checkout unavailable</Text><Text style={styles.message}>{message}</Text></SafeAreaView>; }

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 }, content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  testMode: { color: colors.warning, fontFamily: fontFamily.bold, fontSize: fontSize.caption, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.lg, padding: spacing.lg },
  heading: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle, marginBottom: spacing.md },
  choice: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, marginTop: spacing.sm, padding: spacing.md },
  choiceSelected: { borderColor: colors.primary, borderWidth: 2 }, choiceText: { color: colors.text, fontFamily: fontFamily.medium },
  line: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }, label: { color: colors.textSecondary }, value: { color: colors.text, fontFamily: fontFamily.semibold },
  total: { borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.md },
  totalText: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.body }, note: { color: colors.textSecondary, fontSize: fontSize.footnote, marginTop: spacing.md },
  destinationField: { marginTop: spacing.md }, destinationLabel: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, marginBottom: spacing.xs }, destinationInput: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.text, minHeight: 46, paddingHorizontal: spacing.md }, destinationRow: { flexDirection: 'row', gap: spacing.md }, destinationState: { flex: 2 }, destinationZip: { flex: 3 }, country: { color: colors.textSecondary, fontSize: fontSize.footnote, marginTop: spacing.md },
  message: { color: colors.textSecondary, lineHeight: 21, marginBottom: spacing.md, textAlign: 'center' }, primary: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: 52 },
  primaryText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body }, disabled: { opacity: 0.5 },
});

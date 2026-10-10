import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import {
  acceptDelivery, cancelOrder, completePickup, completePickupByPin, fetchOrder,
  issuePickupProof, markDelivered, markOrderReady, markShipped, openOrderDispute, submitShipmentTracking,
  releaseSellerPayout, respondOrderDispute, uploadDisputeEvidence,
} from '@/features/checkout/checkoutRepository';
import type { MarketplaceOrderRow, OrderShippingDestinationRow, PickupProof } from '@/features/checkout/types';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';
import { fetchOrderReviewStatus } from '@/features/reviews/reviewRepository';
import type { OrderReviewStatus } from '@/features/reviews/types';
import { shippingSafetyLabel } from '@/features/fulfillment/shippingSafetyLabel';
import { PROTECTED_CHECKOUT_ENABLED } from '@/config/launchFeatures';

const pickupSteps = ['Payment received', 'Pickup scheduled', 'Ready for pickup', 'Picked up', 'Completed'];
const shippingSteps = ['Payment received', 'Awaiting shipment', 'Shipped', 'Inspection window', 'Completed'];
const pickupProgress: Record<string, number> = { pickup_scheduled: 1, pickup_ready: 2, pickup_confirmed: 3, completed: 4 };
const shippingProgress: Record<string, number> = { awaiting_shipment: 1, shipped: 2, inspection_window: 3, delivered: 3, completed: 4 };

export function FulfillmentOrderScreen({ orderId }: { orderId: string }) {
  if (!PROTECTED_CHECKOUT_ENABLED) {
    return <SafeAreaView style={styles.center}><Text style={styles.heading}>Protected Checkout unavailable</Text><Text style={styles.help}>Public V1 supports direct local pickup arrangements through messages.</Text></SafeAreaView>;
  }
  return <ConfiguredFulfillmentOrderScreen orderId={orderId} />;
}

function ConfiguredFulfillmentOrderScreen({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const [order, setOrder] = useState<MarketplaceOrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<{ value: PickupProof; pin: string; expiresAt: string } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [pickupPin, setPickupPin] = useState('');
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeType, setDisputeType] = useState<'item_not_received' | 'materially_not_as_described'>('materially_not_as_described');
  const [disputeExplanation, setDisputeExplanation] = useState('');
  const [evidenceUris, setEvidenceUris] = useState<string[]>([]);
  const [sellerResponse, setSellerResponse] = useState('');
  const [now, setNow] = useState(0);
  const [reviewStatus, setReviewStatus] = useState<OrderReviewStatus | null>(null);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);

  const load = useCallback(async () => {
    try {
      setError('');
      const nextOrder = await fetchOrder(orderId);
      setOrder(nextOrder);
      if (nextOrder.fulfillment_status === 'completed') setReviewStatus(await fetchOrderReviewStatus(orderId));
      else setReviewStatus(null);
    }
    catch { setError('Order details could not be loaded.'); }
    finally { setLoading(false); }
  }, [orderId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const role = order && user?.id === order.seller_id ? 'seller' : 'buyer';
  const shipment = useMemo(() => one(order?.order_shipments), [order?.order_shipments]);
  const payout = useMemo(() => one(order?.seller_payout_releases), [order?.seller_payout_releases]);
  const dispute = useMemo(() => one(order?.order_disputes), [order?.order_disputes]);
  const refund = useMemo(() => one(order?.order_refunds), [order?.order_refunds]);
  const destination = useMemo(() => one(order?.order_shipping_destinations), [order?.order_shipping_destinations]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await action(); await load(); Alert.alert('Order updated', success); }
    catch (caught) { Alert.alert('Unable to update order', caught instanceof Error ? caught.message : 'Try again.'); }
    finally { setBusy(false); }
  };

  const showQr = async () => {
    setBusy(true);
    try {
      const result = await issuePickupProof(orderId);
      setProof({ value: result.proof, pin: result.pin, expiresAt: result.expiresAt });
    } catch (caught) { Alert.alert('QR unavailable', caught instanceof Error ? caught.message : 'Try again.'); }
    finally { setBusy(false); }
  };

  const submitPin = async () => {
    if (!/^\d{6}$/.test(pickupPin)) return;
    setBusy(true);
    try {
      const result = await completePickupByPin(orderId, pickupPin);
      if (result.status !== 'completed') {
        Alert.alert('PIN rejected', result.status === 'locked' ? 'Too many attempts. Ask the buyer to generate a new proof.' : 'The PIN is invalid or expired.');
        return;
      }
      setPickupPin(''); await load();
      Alert.alert('Order updated', 'Pickup confirmed. Payout timing is now scheduled.');
    } catch (caught) { Alert.alert('Unable to update order', caught instanceof Error ? caught.message : 'Try again.'); }
    finally { setBusy(false); }
  };

  const chooseEvidence = async () => {
    if (Platform.OS !== 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return Alert.alert('Photo permission needed', 'Allow photo access to attach dispute evidence.');
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true, selectionLimit: 4, quality: 0.85,
    });
    if (!result.canceled) setEvidenceUris(result.assets.slice(0, 4).map((asset) => asset.uri));
  };

  const submitDispute = async () => {
    if (!user || disputeExplanation.trim().length < 20) return;
    setBusy(true);
    try {
      const evidencePaths = await uploadDisputeEvidence(user.id, orderId, evidenceUris);
      await openOrderDispute(orderId, disputeType, disputeExplanation, evidencePaths);
      setDisputeOpen(false); setDisputeExplanation(''); setEvidenceUris([]); await load();
      Alert.alert('Problem reported', 'Seller payout is frozen while the dispute is reviewed.');
    } catch (caught) { Alert.alert('Unable to report problem', caught instanceof Error ? caught.message : 'Try again.'); }
    finally { setBusy(false); }
  };

  const releasePayout = async () => {
    setBusy(true);
    try {
      const result = await releaseSellerPayout(orderId);
      await load();
      Alert.alert(
        result.status === 'reconciling' ? 'Payout is being verified' : 'Payout released',
        result.status === 'reconciling'
          ? 'The transfer may have succeeded and is being reconciled. It will not be released again.'
          : 'The seller transfer was recorded and the order completed.',
      );
    } catch (caught) {
      await load();
      Alert.alert('Unable to release payout', caught instanceof Error ? caught.message : 'Try again.');
    } finally { setBusy(false); }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return Alert.alert('Camera permission needed', 'Allow camera access to scan pickup QR codes.');
    }
    setScanLocked(false); setScannerOpen(true);
  };

  const scan = async ({ data }: { data: string }) => {
    if (scanLocked) return;
    setScanLocked(true);
    let parsed: PickupProof;
    try {
      const value = JSON.parse(data) as Record<string, unknown>;
      if (Object.keys(value).sort().join(',') !== 'buyerId,orderId,token' ||
        typeof value.orderId !== 'string' || typeof value.buyerId !== 'string' || typeof value.token !== 'string') throw new Error();
      parsed = value as unknown as PickupProof;
    } catch { Alert.alert('Invalid QR code', 'This is not a valid pickup code.'); setScanLocked(false); return; }
    await act(() => completePickup(orderId, parsed), 'Pickup confirmed. The order is now eligible for payout.');
    setScannerOpen(false);
  };

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  if (!order || error) return <SafeAreaView style={styles.center}><Text style={styles.error}>{error || 'Order not found.'}</Text><Pressable onPress={() => void load()}><Text style={styles.link}>Try again</Text></Pressable></SafeAreaView>;

  const paid = order.payment_status === 'succeeded';
  const steps = order.fulfillment_type === 'pickup' ? pickupSteps : shippingSteps;
  const progress = !paid ? -1 : (order.fulfillment_type === 'pickup' ? pickupProgress : shippingProgress)[order.fulfillment_status] ?? 0;
  const canRelease = role === 'seller' && ['pickup_confirmed', 'delivered'].includes(order.fulfillment_status)
    && order.transfer_status === 'eligible'
    && order.actual_processing_amount !== null
    && (!order.payout_not_before || new Date(order.payout_not_before).getTime() <= now) && !payout;
  const inspectionRemaining = order.inspection_expires_at
    ? Math.max(0, new Date(order.inspection_expires_at).getTime() - now) : 0;

  return <SafeAreaView style={styles.safeArea}>
    <ScreenHeader title="Order Details" />
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.itemCard}>
        {order.listing_image_url ? <Image accessibilityLabel={`${order.listing_title_snapshot} listing photo`} cachePolicy="memory-disk" contentFit="cover" source={order.listing_image_url} style={styles.image} /> : <View style={[styles.image, styles.placeholder]}><Ionicons name="cube-outline" size={30} color={colors.textMuted} /></View>}
        <View style={styles.itemCopy}><Text numberOfLines={2} style={styles.title}>{order.listing_title_snapshot}</Text><Text style={styles.total}>${(Number(order.total_amount) / 100).toFixed(2)}</Text><Text style={styles.status}>{label(order.fulfillment_status)}</Text><Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/listings/[id]', params: { id: order.listing_id } })} style={styles.listingLink}><Text style={styles.listingLinkText}>View Original Listing</Text><Ionicons color={colors.primary} name="chevron-forward" size={15} /></Pressable></View>
      </View>

      <Section title="Order Timeline">
        {steps.map((step, index) => <View key={step} style={styles.timelineRow}>
          <Ionicons color={index <= progress ? colors.success : colors.textMuted} name={index <= progress ? 'checkmark-circle' : 'ellipse-outline'} size={22} />
          <Text style={[styles.timelineText, index <= progress && styles.timelineDone]}>{step}</Text>
        </View>)}
      </Section>

      {order.fulfillment_type === 'pickup' && role === 'buyer' && ['pickup_scheduled', 'pickup_ready'].includes(order.fulfillment_status) ? <Section title="Pickup proof">
        <Text style={styles.help}>Show the seller the QR or backup PIN. Generating a new proof invalidates both previous codes.</Text>
        {proof ? <View style={styles.qr}><QRCode value={JSON.stringify(proof.value)} size={210} /><Text style={styles.pin}>{proof.pin}</Text><Text style={styles.expiry}>Backup PIN · expires {new Date(proof.expiresAt).toLocaleTimeString()}</Text></View> : null}
        <Action disabled={busy} label={proof ? 'Generate new proof' : 'Show pickup QR and PIN'} onPress={() => void showQr()} />
      </Section> : null}

      {order.fulfillment_type === 'pickup' && role === 'seller' ? <Section title="Pickup actions">
        {order.fulfillment_status === 'pickup_scheduled' ? <Action disabled={busy} label="Mark ready for pickup" onPress={() => void act(() => markOrderReady(orderId), 'Buyer can now present their pickup QR.')} /> : null}
        {order.fulfillment_status === 'pickup_ready' ? <Action disabled={busy} label="Scan buyer QR" onPress={() => void openScanner()} /> : null}
        {order.fulfillment_status === 'pickup_ready' ? <View style={styles.form}><TextInput keyboardType="number-pad" maxLength={6} onChangeText={(value) => setPickupPin(value.replace(/\D/g, ''))} placeholder="6-digit backup PIN" style={styles.input} value={pickupPin} /><Action disabled={busy || !/^\d{6}$/.test(pickupPin)} label="Confirm pickup with PIN" onPress={() => void submitPin()} /></View> : null}
        {scannerOpen ? <View style={styles.scanner}><CameraView active={scannerOpen} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(event) => void scan(event)} style={StyleSheet.absoluteFill} /><Pressable onPress={() => setScannerOpen(false)} style={styles.closeScanner}><Text style={styles.buttonText}>Close scanner</Text></Pressable></View> : null}
      </Section> : null}

      {order.fulfillment_type === 'shipping' ? <Section title="Shipping">
        {destination ? <Detail label="Protected destination" value={formatDestination(destination)} /> : null}
        {order.ship_by_at
          ? <Detail label="Ship by" value={`${new Date(order.ship_by_at).toLocaleString()} (${order.ship_by_timezone ?? 'server timezone'})`} />
          : null}
        {order.shipping_workflow_version === 3 || !order.ship_by_at
          ? <Detail label="Shipping safety" value={shippingSafetyLabel(order.shipping_workflow_version, shipment)} />
          : null}
        {shipment ? <><Detail label="Carrier" value={shipment.carrier} /><Detail label="Tracking" value={shipment.tracking_number} /><Detail label="Status" value={shipment.shipment_state ? label(shipment.shipment_state) : shipment.delivered_at ? 'Delivered' : 'In transit'} />{shipment.tracking_submitted_at ? <Detail label="Tracking submitted" value={new Date(shipment.tracking_submitted_at).toLocaleString()} /> : null}{shipment.carrier_accepted_at ? <Detail label="Carrier accepted" value={new Date(shipment.carrier_accepted_at).toLocaleString()} /> : null}{shipment.shipped_at ? <Detail label="Shipped" value={new Date(shipment.shipped_at).toLocaleString()} /> : null}</> : <Text style={styles.help}>Tracking has not been added yet.</Text>}
        {role === 'seller' && order.fulfillment_status === 'awaiting_shipment' ? <View style={styles.form}><TextInput autoCapitalize="words" onChangeText={setCarrier} placeholder="Carrier" style={styles.input} value={carrier} /><TextInput autoCapitalize="characters" onChangeText={setTracking} placeholder="Tracking number" style={styles.input} value={tracking} /><Action disabled={busy || carrier.trim().length < 2 || tracking.trim().length < 3} label={order.shipping_workflow_version === 3 ? 'Submit tracking' : 'Mark shipped'} onPress={() => void act(() => order.shipping_workflow_version === 3 ? submitShipmentTracking(orderId, carrier, tracking) : markShipped(orderId, carrier, tracking), order.shipping_workflow_version === 3 ? 'Tracking submitted for carrier verification.' : 'Tracking is now visible to the buyer.')} /></View> : null}
        {role === 'buyer' && order.fulfillment_status === 'shipped' && order.shipping_workflow_version !== 3 ? <Action disabled={busy} label="Mark delivered" onPress={() => void act(() => markDelivered(orderId), 'Delivery confirmed.')} /> : null}
        {order.fulfillment_status === 'inspection_window' ? <><Detail label="Inspection remaining" value={duration(inspectionRemaining)} />{role === 'buyer' ? <Action disabled={busy} label="Accept item" onPress={() => void act(() => acceptDelivery(orderId), 'Inspection ended early. Seller payout timing is now scheduled.')} /> : null}</> : null}
      </Section> : null}

      {order.payment_status !== 'none' ? <Section title="Problems, cancellation, and refunds">
        <Detail label="Dispute" value={label(order.dispute_status)} />
        <Detail label="Refund" value={refund?.status ? label(refund.status) : label(order.refund_status)} />
        {role === 'buyer' && !dispute && ['shipped', 'inspection_window'].includes(order.fulfillment_status) ? <Action disabled={busy} label="Report a problem" onPress={() => setDisputeOpen(true)} /> : null}
        {disputeOpen ? <View style={styles.form}><View style={styles.choiceRow}><Pressable onPress={() => setDisputeType('materially_not_as_described')}><Text style={styles.link}>Not as described</Text></Pressable><Pressable onPress={() => setDisputeType('item_not_received')}><Text style={styles.link}>Not received</Text></Pressable></View><TextInput multiline onChangeText={setDisputeExplanation} placeholder="Explain the problem (at least 20 characters)" style={[styles.input, styles.multiline]} value={disputeExplanation} /><Action disabled={busy} label={`Attach photos (${evidenceUris.length})`} onPress={() => void chooseEvidence()} /><Action disabled={busy || disputeExplanation.trim().length < 20} label="Submit report" onPress={() => void submitDispute()} /></View> : null}
        {role === 'seller' && dispute?.status === 'awaiting_seller_response' ? <View style={styles.form}><TextInput multiline onChangeText={setSellerResponse} placeholder="Respond with relevant details" style={[styles.input, styles.multiline]} value={sellerResponse} /><Action disabled={busy || sellerResponse.trim().length < 20} label="Submit response" onPress={() => void act(() => respondOrderDispute(dispute.id, sellerResponse), 'Response submitted for review.')} /></View> : null}
        {['awaiting_payment', 'pickup_scheduled', 'awaiting_shipment'].includes(order.fulfillment_status) ? <Action disabled={busy} label="Cancel order" onPress={() => void act(() => cancelOrder(orderId), 'Cancellation recorded. Any required refund is processing.')} /> : null}
      </Section> : null}

      {reviewStatus?.eligible ? <Section title="Transaction review">
        <Text style={styles.help}>Share feedback about the {role === 'buyer' ? 'seller' : 'buyer'} after this completed transaction.</Text>
        {reviewStatus.reviewed
          ? <View style={styles.reviewed}><Ionicons color={colors.success} name="checkmark-circle" size={20} /><Text style={styles.reviewedText}>Reviewed</Text></View>
          : <Action label="Leave Review" onPress={() => router.push({ pathname: '/leave-review/[orderId]', params: { orderId } })} />}
      </Section> : null}

      {role === 'seller' ? <Section title="Seller payout">
        <Detail label="Item sold" value={money(order.item_amount)} />
        <Detail label="Shipping" value={money(order.shipping_amount)} />
        <Detail label="Marketplace fee" value={`-${money(order.marketplace_fee_amount)}`} />
        <Detail label="Payment processing" value={order.actual_processing_amount === null ? 'Reconciling' : `-${money(order.actual_processing_amount)}`} />
        {order.reserve_withheld_amount > 0 ? <Detail label="Reserve withheld" value={`-${money(order.reserve_withheld_amount)}`} /> : null}
        {payout?.refund_deduction_amount ? <Detail label="Refund deduction" value={`-${money(payout.refund_deduction_amount)}`} /> : null}
        {payout?.financial_adjustment_amount ? <Detail label="Financial adjustments" value={`-${money(payout.financial_adjustment_amount)}`} /> : null}
        <Detail label="You receive" value={order.seller_transfer_amount === null ? 'Pending' : money(order.seller_transfer_amount)} />
        <Detail label="Release status" value={payout?.status ? label(payout.status) : label(order.transfer_status)} />
        {order.payout_not_before ? <Detail label="Scheduled no earlier than" value={new Date(order.payout_not_before).toLocaleString()} /> : null}
        {payout?.transferred_at ? <Detail label="Transferred" value={new Date(payout.transferred_at).toLocaleString()} /> : null}
        {canRelease ? <Action disabled={busy} label="Release seller payout" onPress={() => void releasePayout()} /> : null}
      </Section> : null}
    </ScrollView>
  </SafeAreaView>;
}

function one<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function duration(milliseconds: number) { const minutes = Math.ceil(milliseconds / 60_000); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function money(cents: number) { return `$${(cents / 100).toFixed(2)}`; }
function Section({ children, title }: { children: React.ReactNode; title: string }) { return <View style={styles.section}><Text style={styles.heading}>{title}</Text>{children}</View>; }
function Detail({ label: name, value }: { label: string; value: string }) { return <View style={styles.detail}><Text style={styles.detailLabel}>{name}</Text><Text style={styles.detailValue}>{value}</Text></View>; }
function formatDestination(value: OrderShippingDestinationRow) { return [value.recipient_name, value.address_line1, value.address_line2, `${value.city}, ${value.region} ${value.postal_code}`, value.country_code].filter(Boolean).join('\n'); }
function Action({ disabled, label: name, onPress }: { disabled?: boolean; label: string; onPress: () => void }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{name}</Text></Pressable>; }

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 }, center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  content: { backgroundColor: colors.background, padding: spacing.lg, paddingBottom: spacing.xxxl }, error: { color: colors.text, fontFamily: fontFamily.semibold }, link: { color: colors.primary, marginTop: spacing.md },
  itemCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, flexDirection: 'row', padding: spacing.md }, image: { borderRadius: radii.md, height: 82, width: 82 }, placeholder: { alignItems: 'center', backgroundColor: colors.background, justifyContent: 'center' },
  itemCopy: { flex: 1, marginLeft: spacing.md }, title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body }, total: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.subtitle, marginTop: spacing.xs }, status: { color: colors.info, fontFamily: fontFamily.semibold, marginTop: spacing.xs },
  listingLink: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', marginTop: spacing.sm, minHeight: 28 }, listingLinkText: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  section: { backgroundColor: colors.surface, borderRadius: radii.lg, marginTop: spacing.md, padding: spacing.lg }, heading: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body, marginBottom: spacing.md }, help: { color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  timelineRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 38 }, timelineText: { color: colors.textSecondary, fontFamily: fontFamily.medium }, timelineDone: { color: colors.text }, qr: { alignItems: 'center', marginBottom: spacing.md }, expiry: { color: colors.textSecondary, marginTop: spacing.sm },
  pin: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 34, letterSpacing: 8, marginTop: spacing.md },
  button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, justifyContent: 'center', marginTop: spacing.sm, minHeight: 50, paddingHorizontal: spacing.md }, disabled: { opacity: 0.45 }, buttonText: { color: colors.white, fontFamily: fontFamily.bold },
  reviewed: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }, reviewedText: { color: colors.success, fontFamily: fontFamily.bold },
  scanner: { borderRadius: radii.md, height: 330, marginTop: spacing.md, overflow: 'hidden' }, closeScanner: { alignSelf: 'center', backgroundColor: colors.overlay, borderRadius: radii.md, bottom: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, position: 'absolute' },
  form: { gap: spacing.sm, marginTop: spacing.md }, input: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.text, minHeight: 48, paddingHorizontal: spacing.md },
  multiline: { minHeight: 120, paddingTop: spacing.md, textAlignVertical: 'top' }, choiceRow: { flexDirection: 'row', gap: spacing.lg },
  detail: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 32 }, detailLabel: { color: colors.textSecondary }, detailValue: { color: colors.text, fontFamily: fontFamily.semibold, maxWidth: '65%', textAlign: 'right' },
});

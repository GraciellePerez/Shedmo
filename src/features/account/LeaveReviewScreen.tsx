import { showContentSafetyAlert } from '@/features/safety/showContentSafetyAlert';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import { fetchOrder } from '@/features/checkout/checkoutRepository';
import type { MarketplaceOrderRow } from '@/features/checkout/types';
import { fetchOrderReviewStatus, submitMarketplaceReview } from '@/features/reviews/reviewRepository';
import type { OrderReviewStatus } from '@/features/reviews/types';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function LeaveReviewScreen({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [order, setOrder] = useState<MarketplaceOrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<OrderReviewStatus | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchOrder(orderId), fetchOrderReviewStatus(orderId)]).then(([value, status]) => {
      if (active) { setOrder(value); setReviewStatus(status); }
    }).catch(() => { if (active) setUnavailable(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId]);

  const submit = async () => {
    if (!order || submitting) return;
    if (!rating) return Alert.alert('Select a rating', 'Choose between one and five stars.');
    setSubmitting(true);
    try {
      await submitMarketplaceReview(orderId, rating, text);
      Alert.alert('Review submitted', 'Thanks for helping the marketplace community.', [{ text: 'Done', onPress: () => router.back() }]);
    } catch (error) {
      if (showContentSafetyAlert(error)) return;
      const duplicate = typeof error === 'object' && error != null && 'code' in error && error.code === '23505';
      Alert.alert(duplicate ? 'Already reviewed' : 'Review unavailable', duplicate ? 'Only one review is allowed for each completed transaction.' : 'The review could not be submitted. Confirm the order is completed and try again.');
    } finally { setSubmitting(false); }
  };

  const participant = order && user && (order.buyer_id === user.id || order.seller_id === user.id);
  if (loading || unavailable || !order || !participant || !reviewStatus?.eligible || reviewStatus.reviewed) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title="Leave a Review" />
        <View style={styles.center}><Text style={styles.title}>{loading ? 'Loading transaction…' : reviewStatus?.reviewed ? 'Already reviewed' : 'Transaction unavailable'}</Text><Text style={styles.body}>{reviewStatus?.reviewed ? 'You already submitted feedback for this transaction.' : 'A review can only be submitted by a participant after a completed transaction.'}</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
        <ScreenHeader title="Leave a Review" />
        <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag">
          <View style={styles.item}>
            <Image contentFit="cover" source={order.listing_image_snapshot ?? undefined} style={styles.image} />
            <View style={styles.itemCopy}><Text style={styles.itemTitle}>{order.listing_title_snapshot}</Text><Text style={styles.seller}>{order.buyer_id === user?.id ? 'Review the seller' : 'Review the buyer'}</Text></View>
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>How was your experience?</Text>
            <Text style={styles.body}>Your review helps other marketplace buyers.</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable accessibilityLabel={`${star} stars`} key={star} onPress={() => setRating(star)}>
                  <Ionicons color={star <= rating ? colors.warning : colors.border} name="star" size={42} />
                </Pressable>
              ))}
            </View>
            <TextInput
              maxLength={800}
              multiline
              onChangeText={setText}
              placeholder="Describe the item, communication, and delivery..."
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              textAlignVertical="top"
              value={text}
            />
            <Text style={styles.counter}>{text.length}/800</Text>
          </View>
          <Pressable disabled={submitting} onPress={() => void submit()} style={styles.submit}><Text style={styles.submitText}>{submitting ? 'Submitting…' : 'Submit Review'}</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  keyboard: { flex: 1 },
  content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxxl },
  item: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, flexDirection: 'row', marginBottom: spacing.md, padding: spacing.md },
  image: { borderRadius: radii.md, height: 64, width: 64 },
  itemCopy: { flex: 1, marginLeft: spacing.md },
  itemTitle: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  seller: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginTop: 4 },
  card: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, textAlign: 'center' },
  body: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 20, marginTop: spacing.sm, textAlign: 'center' },
  stars: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.xxl },
  input: { backgroundColor: colors.background, borderRadius: radii.md, color: colors.text, fontFamily: fontFamily.regular, fontSize: fontSize.body, minHeight: 130, padding: spacing.md, width: '100%' },
  counter: { alignSelf: 'flex-end', color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: spacing.xs },
  submit: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14, justifyContent: 'center', marginTop: spacing.md, minHeight: 52 },
  submitText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xxxl },
});

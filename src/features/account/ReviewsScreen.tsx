import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { ReportModal } from '@/features/reports/components/ReportModal';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { fetchProfileReviews } from '@/features/reviews/reviewRepository';
import type { MarketplaceReview } from '@/features/reviews/types';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function ReviewsScreen({ sellerId }: { sellerId: string }) {
  const { user } = useAuthStore();
  const [reportedReviewId, setReportedReviewId] = useState<string | null>(null);
  const [items, setItems] = useState<MarketplaceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    setLoading(true);
    setItems([]);
    setReportedReviewId(null);
    void fetchProfileReviews(sellerId)
      .then((value) => { if (active) setItems(value); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload, sellerId]);
  const average = useMemo(
    () => items.length ? items.reduce((sum, item) => sum + item.rating, 0) / items.length : 0,
    [items],
  );
  const distribution = [5, 4, 3, 2, 1].map((rating) => ({
    rating, count: items.filter((item) => item.rating === rating).length,
  }));

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="Reviews" />
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} /> : <View style={styles.empty}><Ionicons color={colors.textSecondary} name={error ? 'cloud-offline-outline' : 'chatbubble-ellipses-outline'} size={34} /><Text style={styles.emptyTitle}>{error ? 'Reviews unavailable' : 'No reviews yet'}</Text><Text style={styles.count}>{error ? 'Check your connection and try again.' : 'Completed transactions can be reviewed here.'}</Text>{error ? <Pressable onPress={() => { setLoading(true); setReload((value) => value + 1); }}><Text style={styles.retry}>Retry</Text></Pressable> : null}</View>}
        ListHeaderComponent={<View style={styles.summary}><View style={styles.average}><Text style={styles.averageValue}>{average.toFixed(1)}</Text><Stars value={Math.round(average)} /><Text style={styles.count}>{items.length} reviews</Text></View><View style={styles.distribution}>{distribution.map((item) => <View key={item.rating} style={styles.barRow}><Text style={styles.barLabel}>{item.rating}</Text><View style={styles.barTrack}><View style={[styles.barFill, { width: `${items.length ? (item.count / items.length) * 100 : 0}%` }]} /></View><Text style={styles.barCount}>{item.count}</Text></View>)}</View></View>}
        renderItem={({ item }) => <View style={styles.review}><View style={styles.reviewTop}><Avatar imageUri={item.reviewerAvatarUrl ?? undefined} initials={initials(item.reviewerName)} size={38} /><View style={styles.reviewer}><Text style={styles.reviewerName}>{item.reviewerName}</Text><Text style={styles.related}>{item.direction === 'buyer_to_seller' ? 'Buyer review' : 'Seller review'} · {new Date(item.createdAt).toLocaleDateString()}</Text></View><Stars value={item.rating} /></View>{item.body ? <Text style={styles.reviewText}>{item.body}</Text> : null}{user && user.id !== item.reviewerId ? <Pressable accessibilityLabel="Report review" onPress={() => setReportedReviewId(item.id)}><Text style={styles.retry}>Report review</Text></Pressable> : null}</View>}
      />
      {reportedReviewId ? <ReportModal visible target={{ type: 'review', targetId: reportedReviewId }} onClose={() => setReportedReviewId(null)} /> : null}
    </SafeAreaView>
  );
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function Stars({ value }: { value: number }) { return <View style={styles.stars}>{[1, 2, 3, 4, 5].map((star) => <Ionicons color={star <= value ? colors.warning : colors.border} key={star} name="star" size={12} />)}</View>; }

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 }, content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxxl },
  summary: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, flexDirection: 'row', gap: spacing.xxl, marginBottom: spacing.md, padding: spacing.xl },
  average: { alignItems: 'center' }, averageValue: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 42 }, stars: { flexDirection: 'row', gap: 2, marginTop: 4 }, count: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginTop: 5 }, distribution: { flex: 1 },
  barRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginVertical: 3 }, barLabel: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, width: 8 }, barTrack: { backgroundColor: colors.background, borderRadius: 3, flex: 1, height: 6, overflow: 'hidden' }, barFill: { backgroundColor: colors.warning, borderRadius: 3, height: 6 }, barCount: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, width: 15 },
  review: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.md, padding: spacing.lg }, reviewTop: { alignItems: 'center', flexDirection: 'row' }, reviewer: { flex: 1, marginLeft: spacing.md }, reviewerName: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.bodySmall }, related: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: 2 }, reviewText: { color: colors.text, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 20, marginTop: spacing.md },
  empty: { alignItems: 'center', padding: spacing.xxxl }, emptyTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title, marginTop: spacing.md },
  retry: { color: colors.primary, fontFamily: fontFamily.bold, marginTop: spacing.md },
});

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ManagedListing } from '@/features/listings/store/ListingStore';
import { colors, fontFamily, fontSize, radii, shadows, spacing } from '@/theme';

export function ManagedListingCard({
  item,
  onDelete,
  onEdit,
  onOpen,
  onSold,
  onArchive,
}: {
  item: ManagedListing;
  onDelete: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onSold: () => void;
  onArchive: () => void;
}) {
  return (
    <View style={[styles.card, shadows.card]}>
      <Pressable onPress={onOpen} style={styles.main}>
        <Image contentFit="cover" source={item.listing.image} style={styles.image} />
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text numberOfLines={2} style={styles.title}>{item.listing.title}</Text>
            <Status status={item.status} />
          </View>
          <Text style={styles.price}>${item.listing.price.toLocaleString()}</Text>
          <View style={styles.metrics}>
            <Metric icon="eye-outline" value={item.listing.views} />
            <Metric icon="heart-outline" value={item.saves} />
            <Metric icon="chatbubble-outline" value={item.messages} />
          </View>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Action icon="create-outline" label="Edit" onPress={onEdit} />
        {item.status === 'active' ? <Action icon="checkmark-circle-outline" label="Mark Sold" onPress={onSold} /> : null}
        {item.status === 'pending_local_confirmation' ? <Action icon="time-outline" label="View Sale" onPress={onSold} /> : null}
        {item.status === 'sold' ? <Action icon="receipt-outline" label="Sale Status" onPress={onSold} /> : null}
        {item.status !== 'archived' ? <Action icon="archive-outline" label="Archive" onPress={onArchive} /> : null}
        <Action danger icon="trash-outline" label="Delete" onPress={onDelete} />
      </View>
    </View>
  );
}

function Status({ status }: { status: ManagedListing['status'] }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <View style={[styles.status, status === 'sold' && styles.soldStatus]}>
      <Text style={[styles.statusText, status === 'sold' && styles.soldStatusText]}>{label}</Text>
    </View>
  );
}

function Metric({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: number }) {
  return (
    <View style={styles.metric}>
      <Ionicons color={colors.textSecondary} name={icon} size={13} />
      <Text style={styles.metricText}>{value}</Text>
    </View>
  );
}

function Action({ danger, icon, label, onPress }: { danger?: boolean; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Ionicons color={danger ? colors.primary : colors.text} name={icon} size={15} />
      <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.md, overflow: 'hidden' },
  main: { flexDirection: 'row', padding: spacing.md },
  image: { borderRadius: radii.md, height: 96, width: 96 },
  copy: { flex: 1, marginLeft: spacing.md },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  title: { color: colors.text, flex: 1, fontFamily: fontFamily.semibold, fontSize: fontSize.body, lineHeight: 20 },
  price: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.subtitle, marginTop: spacing.xs },
  status: { backgroundColor: '#EAF8EE', borderRadius: radii.round, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: colors.success, fontFamily: fontFamily.bold, fontSize: fontSize.caption },
  soldStatus: { backgroundColor: colors.background },
  soldStatusText: { color: colors.textSecondary },
  metrics: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  metric: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  metricText: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote },
  actions: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  action: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 42 },
  actionText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.footnote },
  danger: { color: colors.primary },
  pressed: { backgroundColor: colors.background },
});

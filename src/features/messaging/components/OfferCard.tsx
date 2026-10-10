import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { OfferAction, OfferMessage } from '@/features/messaging/types/messaging';
import { colors, fontFamily, fontSize, radii, shadows, spacing } from '@/theme';

export function OfferCard({
  message,
  onAction,
}: {
  message: OfferMessage;
  onAction: (action: OfferAction) => void;
}) {
  const pending = message.offer.status === 'pending';

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.heading}>
          <View style={styles.icon}>
            <Ionicons color={colors.primary} name="pricetag" size={18} />
          </View>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>{message.fromMe ? 'YOUR OFFER' : 'NEW OFFER'}</Text>
            <Text style={styles.amount}>${message.offer.amount.toLocaleString()}</Text>
          </View>
          <StatusBadge status={message.offer.status} />
        </View>
        <View style={styles.priceLine}>
          <Text style={styles.priceLabel}>Listing price</Text>
          <Text style={styles.listingPrice}>${message.offer.listingPrice.toLocaleString()}</Text>
        </View>
        {pending && !message.fromMe ? (
          <View style={styles.actions}>
            <OfferButton label="Decline" onPress={() => onAction('declined')} />
            <OfferButton label="Counter" onPress={() => onAction('countered')} />
            <OfferButton filled label="Accept" onPress={() => onAction('accepted')} />
          </View>
        ) : null}
        <Text style={styles.time}>{message.time}</Text>
      </View>
    </View>
  );
}

function StatusBadge({ status }: { status: OfferMessage['offer']['status'] }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <View style={[styles.status, status === 'accepted' && styles.accepted, status === 'declined' && styles.declined]}>
      <Text style={[styles.statusText, status === 'accepted' && styles.acceptedText, status === 'declined' && styles.declinedText]}>
        {label}
      </Text>
    </View>
  );
}

function OfferButton({ filled = false, label, onPress }: { filled?: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.button, filled && styles.filled, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, filled && styles.filledText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, padding: spacing.lg, ...shadows.card },
  heading: { alignItems: 'center', flexDirection: 'row' },
  icon: { alignItems: 'center', backgroundColor: '#FFF1F0', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  headingCopy: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.textSecondary, fontFamily: fontFamily.bold, fontSize: fontSize.caption, letterSpacing: 0.7 },
  amount: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 24, marginTop: 1 },
  status: { backgroundColor: '#FFF7E6', borderRadius: radii.round, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { color: colors.warning, fontFamily: fontFamily.bold, fontSize: fontSize.footnote },
  accepted: { backgroundColor: '#EAF8EE' },
  acceptedText: { color: colors.success },
  declined: { backgroundColor: colors.background },
  declinedText: { color: colors.textSecondary },
  priceLine: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md },
  priceLabel: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall },
  listingPrice: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  button: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 38 },
  filled: { backgroundColor: colors.primary, borderColor: colors.primary },
  buttonText: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.footnote },
  filledText: { color: colors.white },
  pressed: { opacity: 0.72 },
  time: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption, marginTop: spacing.sm, textAlign: 'right' },
});

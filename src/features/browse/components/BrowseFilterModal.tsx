import { useEffect, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FilterChip } from '@/features/browse/components/FilterChip';
import type { ListingSearchFilters } from '@/features/browse/types/search';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';
import { LISTING_CATEGORY_OPTIONS } from '@/features/listings/categoryLabels';
import { PUBLIC_SHIPPING_ENABLED } from '@/config/launchFeatures';

const conditions = [
  ['new', 'New'], ['like_new', 'Like New'], ['good', 'Good'], ['fair', 'Fair'],
  ['for_parts', 'For Parts'],
] as const;
const distanceRadii = [10, 25, 50, 100, 250] as const;

interface Props {
  error: string | null;
  filters: ListingSearchFilters;
  visible: boolean;
  onApply: (filters: ListingSearchFilters) => boolean;
  onClose: () => void;
}

export function BrowseFilterModal({ error, filters, visible, onApply, onClose }: Props) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => { if (visible) setDraft(filters); }, [filters, visible]);
  const update = <K extends keyof ListingSearchFilters>(key: K, value: ListingSearchFilters[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={onClose}><Text style={styles.cancel}>Cancel</Text></Pressable>
          <Text style={styles.title}>Filters</Text>
          <Pressable onPress={() => setDraft({ ...draft, category: null, condition: null, minPrice: '', maxPrice: '', radius: null, fulfillment: 'all' })}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Group title="Category">
            <View style={styles.wrap}>
              <FilterChip active={draft.category == null} label="All" onPress={() => update('category', null)} />
              {LISTING_CATEGORY_OPTIONS.map(([value, label]) => (
                <FilterChip active={draft.category === value} key={value} label={label} onPress={() => update('category', value)} />
              ))}
            </View>
          </Group>
          <Group title="Condition">
            <View style={styles.wrap}>
              <FilterChip active={draft.condition == null} label="All" onPress={() => update('condition', null)} />
              {conditions.map(([value, label]) => (
                <FilterChip active={draft.condition === value} key={value} label={label} onPress={() => update('condition', value)} />
              ))}
            </View>
          </Group>
          <Group title="Price">
            <View style={styles.priceRow}>
              <TextInput keyboardType="decimal-pad" onChangeText={(value) => update('minPrice', value)} placeholder="Minimum" style={styles.input} value={draft.minPrice} />
              <TextInput keyboardType="decimal-pad" onChangeText={(value) => update('maxPrice', value)} placeholder="Maximum" style={styles.input} value={draft.maxPrice} />
            </View>
          </Group>
          <Group title="Distance">
            <View style={styles.wrap}>
              <FilterChip active={draft.radius == null} label="Any" onPress={() => update('radius', null)} />
              {distanceRadii.map((value) => (
                <FilterChip active={draft.radius === value} key={value} label={`${value} mi`} onPress={() => update('radius', value)} />
              ))}
            </View>
          </Group>
          <Group title="Delivery">
            <View style={styles.wrap}>
              {PUBLIC_SHIPPING_ENABLED ? <FilterChip active={draft.fulfillment === 'all'} label="Pickup or shipping" onPress={() => update('fulfillment', 'all')} /> : null}
              <FilterChip active={draft.fulfillment === 'pickup'} label="Pickup only" onPress={() => update('fulfillment', 'pickup')} />
              {PUBLIC_SHIPPING_ENABLED ? <FilterChip active={draft.fulfillment === 'shipping'} label="Shipping only" onPress={() => update('fulfillment', 'shipping')} /> : null}
            </View>
          </Group>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <Pressable onPress={() => { if (onApply(draft)) onClose(); }} style={styles.apply}>
          <Text style={styles.applyText}>Apply Filters</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

function Group({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.group}><Text style={styles.groupTitle}>{title}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.surface, flex: 1 },
  header: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.lg },
  cancel: { color: colors.textSecondary, fontFamily: fontFamily.medium },
  clear: { color: colors.primary, fontFamily: fontFamily.semibold },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title },
  content: { padding: spacing.lg },
  group: { marginBottom: spacing.xl },
  groupTitle: { color: colors.text, fontFamily: fontFamily.bold, marginBottom: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  priceRow: { flexDirection: 'row', gap: spacing.md },
  input: { backgroundColor: colors.background, borderRadius: radii.md, color: colors.text, flex: 1, minHeight: 48, paddingHorizontal: spacing.md },
  error: { color: colors.primary, fontFamily: fontFamily.medium },
  apply: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, margin: spacing.lg, padding: spacing.lg },
  applyText: { color: colors.white, fontFamily: fontFamily.bold },
});

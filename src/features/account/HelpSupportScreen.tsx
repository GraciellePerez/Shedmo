import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

const faqs = [
  { q: 'How do I buy an item?', a: 'Open a listing, message the seller, and arrange a local pickup. Inspect the item before paying the seller directly.' },
  { q: 'How do local pickups work?', a: 'Agree on a public location in messages. Inspect the item before exchanging funds.' },
  { q: 'Can I change a listing after publishing?', a: 'Open My Listings, choose your listing, and select Edit Listing.' },
  { q: 'What should I do about suspicious activity?', a: 'Stop communication, do not send money, and use the report options available in the app.' },
];

export function HelpSupportScreen() {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = useMemo(() => faqs.filter((item) => `${item.q} ${item.a}`.toLowerCase().includes(query.trim().toLowerCase())), [query]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title="Help and Support" />
      <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
          <View style={styles.search}>
            <Ionicons color={colors.textSecondary} name="search" size={18} />
            <TextInput onChangeText={setQuery} placeholder="Search help topics" placeholderTextColor={colors.textSecondary} style={styles.searchInput} value={query} />
          </View>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          <View style={styles.card}>
            {filtered.map((item, index) => (
              <Pressable key={item.q} onPress={() => setExpanded((current) => current === item.q ? null : item.q)} style={[styles.faq, index < filtered.length - 1 && styles.divider]}>
                <View style={styles.faqTop}><Text style={styles.question}>{item.q}</Text><Ionicons color={colors.textSecondary} name={expanded === item.q ? 'chevron-up' : 'chevron-down'} size={18} /></View>
                {expanded === item.q ? <Text style={styles.answer}>{item.a}</Text> : null}
              </Pressable>
            ))}
            {!filtered.length ? <Text style={styles.noResults}>No help topics match your search.</Text> : null}
          </View>
          <Text style={styles.sectionTitle}>Shedmo Safety</Text>
          <View style={styles.safety}>
            <Safety icon="people-outline" text="Meet in a well-lit public place for local pickup." />
            <Safety icon="search-outline" text="Inspect tools and equipment before completing an exchange." />
            <Safety icon="shield-checkmark-outline" text="Keep communication in the marketplace and never share account codes." />
          </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Safety({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.safetyRow}><Ionicons color={colors.success} name={icon} size={20} /><Text style={styles.safetyText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { backgroundColor: colors.background, padding: spacing.lg, paddingBottom: spacing.xxxl },
  search: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.md, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
  searchInput: { color: colors.text, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.body, minHeight: 48 },
  sectionTitle: { color: colors.textSecondary, fontFamily: fontFamily.bold, fontSize: fontSize.caption, letterSpacing: 0.7, marginBottom: spacing.sm, marginTop: spacing.xl, textTransform: 'uppercase' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  faq: { padding: spacing.lg },
  divider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  faqTop: { alignItems: 'center', flexDirection: 'row' },
  question: { color: colors.text, flex: 1, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  answer: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 20, marginTop: spacing.sm },
  noResults: { color: colors.textSecondary, fontFamily: fontFamily.regular, padding: spacing.xl, textAlign: 'center' },
  safety: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  safetyRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  safetyText: { color: colors.text, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.bodySmall, lineHeight: 20 },
});

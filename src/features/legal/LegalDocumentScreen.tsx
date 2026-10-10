import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { colors, fontFamily, spacing } from '@/theme';
import { LEGAL_EFFECTIVE_DATE, legalDocuments, type LegalSlug } from './legalDocuments';

export function LegalDocumentScreen({ slug }: { slug: LegalSlug }) {
  const document = legalDocuments[slug];
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenHeader title={slug === 'prohibited-items' ? 'Marketplace Rules' : document.title} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.document}>
          <Text accessibilityRole="header" style={styles.title}>{document.title}</Text>
          <Text selectable style={styles.date}>Effective Date: {LEGAL_EFFECTIVE_DATE}</Text>
          {document.body.split('\n\n').map((paragraph, index) => (
            <View key={index} style={styles.paragraph}>
              {paragraph.split('\n').map((line, lineIndex) => {
                const heading = /^\d+\. /.test(line);
                return (
                  <Text
                    accessibilityRole={heading ? 'header' : undefined}
                    key={lineIndex}
                    selectable
                    style={[styles.body, heading && styles.heading, line.startsWith('- ') && styles.bullet]}
                  >
                    {line === 'shedmoapp@gmail.com' || line === 'Email: shedmoapp@gmail.com' ? (
                      <Link href="mailto:shedmoapp@gmail.com" style={styles.link}>{line}</Link>
                    ) : line === 'See Shedmo Prohibited Items & Marketplace Rules for additional restrictions.' ? (
                      <Link href={{ pathname: '/settings/[slug]', params: { slug: 'prohibited-items' } }} style={styles.link}>{line}</Link>
                    ) : line}
                  </Text>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  document: { alignSelf: 'center', maxWidth: 720, width: '100%' },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: 26, lineHeight: 34 },
  date: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 24, marginVertical: spacing.lg },
  paragraph: { marginBottom: spacing.md },
  body: { color: colors.text, fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 25 },
  heading: { fontFamily: fontFamily.bold, fontSize: 20, lineHeight: 28, marginTop: spacing.lg },
  bullet: { paddingLeft: spacing.sm, marginTop: spacing.xs },
  link: { color: colors.primary, textDecorationLine: 'underline' },
});

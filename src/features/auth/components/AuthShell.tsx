import { Image } from 'expo-image';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

export function AuthShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
          <Image contentFit="contain" source={require('../../../../assets/shedmo-icon.png')} style={styles.mark} />
          <Text style={styles.brand}>Shedmo</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <View style={styles.card}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  keyboard: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, paddingBottom: spacing.xxxl },
  mark: { alignItems: 'center', alignSelf: 'center', borderRadius: radii.lg, height: 62, justifyContent: 'center', width: 62 },
  brand: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: fontSize.title, marginTop: spacing.md, textAlign: 'center' },
  accent: { color: colors.primary },
  title: { color: colors.text, fontFamily: fontFamily.extraBold, fontSize: 28, marginTop: spacing.xxxl, textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.body, lineHeight: 22, marginTop: spacing.sm, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, marginTop: spacing.xl, padding: spacing.lg },
});

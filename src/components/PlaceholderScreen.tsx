import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>This screen is reserved for a later migration phase.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  title: {
    color: colors.text,
    fontFamily: fontFamily.extraBold,
    fontSize: fontSize.display,
  },
  body: {
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});

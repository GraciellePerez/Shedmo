import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, spacing } from '@/theme';

export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="Go back" hitSlop={10} onPress={() => router.back()} style={styles.side}>
        <Ionicons color={colors.text} name="chevron-back" size={26} />
      </Pressable>
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 54, paddingHorizontal: spacing.md },
  side: { alignItems: 'flex-start', justifyContent: 'center', minWidth: 54 },
  right: { alignItems: 'flex-end' },
  title: { color: colors.text, flex: 1, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle, textAlign: 'center' },
});

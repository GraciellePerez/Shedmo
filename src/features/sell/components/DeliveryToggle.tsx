import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

interface DeliveryToggleProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onChange: () => void;
  subtitle: string;
  value: boolean;
}

export function DeliveryToggle({ icon, label, onChange, subtitle, value }: DeliveryToggleProps) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={onChange} style={styles.row}>
      <View style={styles.leading}>
        <View style={styles.iconBox}>
          <Ionicons color={colors.text} name={icon} size={20} />
        </View>
        <View>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 62 },
  leading: { alignItems: 'center', flexDirection: 'row', flex: 1 },
  iconBox: { alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.sm, height: 38, justifyContent: 'center', marginRight: spacing.md, width: 38 },
  label: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: 14 },
  subtitle: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.footnote, marginTop: spacing.xxs },
  switch: { backgroundColor: colors.border, borderRadius: 16, height: 31, padding: 2, width: 51 },
  switchOn: { backgroundColor: colors.primary },
  knob: { backgroundColor: colors.white, borderRadius: 14, height: 27, width: 27 },
  knobOn: { transform: [{ translateX: 20 }] },
});

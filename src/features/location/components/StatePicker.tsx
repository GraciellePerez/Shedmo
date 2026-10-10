import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { US_STATES, type USStateCode } from '@/features/location/locationValidation';
import { colors, fontFamily, radii, spacing } from '@/theme';

export function StatePicker({ error, onChange, value }: {
  error?: string; onChange: (value: USStateCode) => void; value: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Pressable onPress={() => setVisible(true)} style={[styles.field, error && styles.error]}>
        <Text style={value ? styles.value : styles.placeholder}>{value || 'State'}</Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Modal animationType="slide" onRequestClose={() => setVisible(false)} presentationStyle="pageSheet" visible={visible}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.header}>
            <Text style={styles.title}>Select State</Text>
            <Pressable onPress={() => setVisible(false)}><Text style={styles.done}>Done</Text></Pressable>
          </View>
          <ScrollView>
            {US_STATES.map(([code, name]) => (
              <Pressable
                accessibilityRole="button"
                key={code}
                onPress={() => { onChange(code); setVisible(false); }}
                style={styles.option}
              >
                <Text style={styles.name}>{name}</Text><Text style={styles.code}>{code}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.surface, flex: 1 },
  field: { alignItems: 'center', backgroundColor: colors.background, borderColor: 'transparent', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: spacing.md },
  error: { borderColor: colors.primary },
  value: { color: colors.text, fontFamily: fontFamily.regular },
  placeholder: { color: colors.textSecondary, fontFamily: fontFamily.regular },
  chevron: { color: colors.textSecondary },
  errorText: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: 12, marginTop: 5 },
  header: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.lg },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: 18 },
  done: { color: colors.primary, fontFamily: fontFamily.semibold },
  option: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.lg },
  name: { color: colors.text, fontFamily: fontFamily.regular },
  code: { color: colors.textSecondary, fontFamily: fontFamily.semibold },
});

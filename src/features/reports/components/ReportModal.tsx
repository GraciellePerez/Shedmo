import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReportSubmission } from '@/features/reports/hooks/useReportSubmission';
import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  type ReportReason,
  type ReportTarget,
} from '@/features/reports/types/report';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

interface ReportModalProps {
  onClose: () => void;
  target: ReportTarget;
  visible: boolean;
}

export function ReportModal({ onClose, target, visible }: ReportModalProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const { submit, submitting } = useReportSubmission();

  useEffect(() => {
    if (!visible) {
      setReason(null);
      setDetails('');
    }
  }, [visible]);

  const submitReport = async () => {
    const result = await submit(target, reason, details);
    Alert.alert(result.message);
    if (result.success) onClose();
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Close report form"
              disabled={submitting}
              hitSlop={10}
              onPress={onClose}
              style={styles.headerAction}
            >
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.title}>Report {target.type}</Text>
            <View style={styles.headerAction} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.intro}>
              Choose the reason that best describes the issue. Reports are private and do not
              automatically remove content.
            </Text>
            <Text style={styles.label}>Reason</Text>
            <View style={styles.reasons}>
              {REPORT_REASONS[target.type].map((option) => {
                const selected = reason === option.value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    disabled={submitting}
                    key={option.value}
                    onPress={() => setReason(option.value)}
                    style={[styles.reason, selected && styles.reasonSelected]}
                  >
                    <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                      {option.label}
                    </Text>
                    <Ionicons
                      color={selected ? colors.primary : colors.textMuted}
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={21}
                    />
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.detailsHeader}>
              <Text style={styles.label}>
                Details {reason === 'other' ? '(required)' : '(optional)'}
              </Text>
              <Text style={styles.count}>{details.length}/{REPORT_DETAILS_MAX_LENGTH}</Text>
            </View>
            <TextInput
              editable={!submitting}
              maxLength={REPORT_DETAILS_MAX_LENGTH}
              multiline
              onChangeText={setDetails}
              placeholder="Briefly explain what happened. Do not include sensitive personal information."
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              textAlignVertical="top"
              value={details}
            />

            <Pressable
              disabled={submitting}
              onPress={() => void submitReport()}
              style={[styles.submit, submitting && styles.disabled]}
            >
              <Text style={styles.submitText}>
                {submitting ? 'Submitting…' : 'Submit report'}
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.surface, flex: 1 },
  keyboard: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: spacing.lg,
  },
  headerAction: { minWidth: 64 },
  cancel: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.body },
  title: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.subtitle },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  intro: {
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.bodySmall,
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  label: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  reasons: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  reason: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 49,
    paddingHorizontal: spacing.lg,
  },
  reasonSelected: { backgroundColor: '#FFF5F5' },
  reasonText: { color: colors.text, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall },
  reasonTextSelected: { color: colors.primary },
  detailsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
  },
  count: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: fontSize.caption },
  input: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    lineHeight: 21,
    marginTop: spacing.sm,
    minHeight: 120,
    padding: spacing.md,
  },
  submit: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    justifyContent: 'center',
    marginTop: spacing.xl,
    minHeight: 52,
  },
  submitText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  disabled: { opacity: 0.55 },
});

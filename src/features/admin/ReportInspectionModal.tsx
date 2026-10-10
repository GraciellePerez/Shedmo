import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontFamily, spacing } from '@/theme';
import { adminOperation } from './adminRepository';

interface Inspection {
  report_id: string;
  type: string;
  status: string;
  reason: string;
  details: string | null;
  resolution_note: string | null;
  suppressed: boolean;
  revision: string;
  content: Record<string, unknown> | null;
  images: { url: string; label: string }[];
  imageWarnings: string[];
  history: { actor: string; action: string; timestamp: string; outcome: string | null; note: string | null }[];
}

export function ReportInspectionModal({ reportId, onClose, onUpdated }: {
  reportId: string; onClose: () => void; onUpdated: () => void;
}) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setInspection(null); setError(''); setBusy(true);
    void adminOperation<Inspection>('inspect_report', { id: reportId }).then(value => {
      if (active) setInspection(value);
    }).catch(() => { if (active) setError('Inspection unavailable. Refresh and try again.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [reportId, refresh]);

  const act = (action: 'suppress' | 'restore' | 'resolved' | 'dismissed' | 'under_review') => {
    if (!inspection || busy) return;
    if (action !== 'under_review' && note.trim().length < 3) {
      Alert.alert('Add a moderation note', 'Record the reason without copying private content into the note.'); return;
    }
    Alert.alert('Confirm moderation action', `${action.replace('_', ' ')} this reported content/report?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => {
        setBusy(true); setError('');
        const contentAction = action === 'suppress' || action === 'restore';
        void adminOperation(contentAction ? 'moderate_report_content' : 'report_action', {
          id: reportId, action, note: note.trim(), revision: inspection.revision,
        }).then(() => { setNote(''); onUpdated(); setRefresh(value => value + 1); })
          .catch(() => setError('Action was not completed. Refresh to inspect current content before retrying. Restoring text must also pass the safety rules.'))
          .finally(() => setBusy(false));
      } },
    ]);
  };

  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Text style={styles.title}>Inspect report</Text><Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.content}>
        {busy ? <ActivityIndicator color={colors.primary} /> : null}
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
        <Pressable disabled={busy} onPress={() => setRefresh(value => value + 1)}><Text style={styles.link}>Refresh inspection and photos</Text></Pressable>
        {inspection ? <>
          <Text selectable>Report: {inspection.report_id}</Text>
          <Text>{inspection.type} · {inspection.status} · {inspection.reason}</Text>
          <Text>{inspection.details || 'No additional report details.'}</Text>
          {inspection.resolution_note ? <Text>Resolution note: {inspection.resolution_note}</Text> : null}
          <Text style={styles.title}>{inspection.suppressed ? 'Suppressed — original evidence' : 'Reported content'}</Text>
          {!inspection.content ? <Text>Original content is no longer available.</Text> : Object.entries(inspection.content)
            .filter(([key]) => !['images', 'avatar_url', 'attachment_path', 'attachment_mime_type'].includes(key))
            .map(([key, value]) => <Text selectable key={key}>{key}: {String(value ?? '—')}</Text>)}
          {inspection.images.map((item, index) => <View key={`${refresh}-${index}`}><Text>{item.label}</Text>
            <Image source={{ uri: item.url }} style={styles.photo} contentFit="contain" cachePolicy="none" accessibilityLabel={item.label}
              onError={() => setError('A photo could not be displayed. Refresh or escalate storage inspection; do not assume it is safe.')} />
          </View>)}
          {inspection.imageWarnings.map((warning, index) => <Text accessibilityRole="alert" key={index}>{warning}</Text>)}
          {inspection.images.length ? <Text>Photo access expires after one minute. Refresh if needed. Previously issued links or downloaded copies may outlive a takedown.</Text> : null}
          <TextInput accessibilityLabel="Moderation note" multiline maxLength={500} value={note} onChangeText={setNote}
            placeholder="Reason / outcome (do not copy private evidence)" style={styles.input} />
          <View style={styles.actions}>
            {(['under_review', ...(inspection.content ? [inspection.suppressed ? 'restore' : 'suppress'] : []), 'resolved', 'dismissed'] as const)
              .map(action => <Pressable key={action} disabled={busy} style={styles.button} onPress={() => act(action as Parameters<typeof act>[0])}>
                <Text style={styles.buttonText}>{action === 'suppress' ? 'Suppress content' : action === 'restore' ? 'Restore content' : action === 'under_review' ? 'Mark under review' : action === 'resolved' ? 'Resolve report' : 'Dismiss report'}</Text>
              </Pressable>)}
          </View>
          <Text style={styles.title}>Action history</Text>
          {inspection.history.map((item, index) => <Text key={index}>{item.timestamp} · {item.actor} · {item.action} · {item.outcome || ''}{item.note ? ` · ${item.note}` : ''}</Text>)}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.lg },
  title: { fontFamily: fontFamily.bold, fontSize: 18, marginVertical: spacing.sm },
  link: { color: colors.primary, fontFamily: fontFamily.semibold, paddingVertical: spacing.sm },
  content: { padding: spacing.lg, gap: spacing.sm },
  photo: { width: '100%', height: 260 },
  input: { borderWidth: 1, borderColor: colors.border, padding: spacing.md, minHeight: 90 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 8 },
  buttonText: { color: colors.white, fontFamily: fontFamily.semibold },
});

import type {
  ReportReason,
  ReportSubmissionStatus,
  ReportTarget,
} from '@/features/reports/types/report';
import { requireSupabase } from '@/lib/supabase/client';
import { telemetry } from '@/services/telemetry';

const KNOWN_RESULTS = new Set<ReportSubmissionStatus>([
  'submitted',
  'duplicate',
  'invalid_input',
  'invalid_target',
  'unavailable',
]);

export async function submitContentReport(
  target: ReportTarget,
  reason: ReportReason,
  details: string,
): Promise<ReportSubmissionStatus> {
  const client = requireSupabase();
  const { data, error } = target.type === 'review'
    ? await client.rpc('submit_review_report_v1', {
      p_review_id: target.targetId, p_reason: reason, p_details: details.trim() || null,
    })
    : await client.rpc('submit_content_report', {
      p_report_type: target.type,
      p_target_id: target.targetId,
      p_reason: reason,
      p_details: details.trim() || null,
      p_conversation_id: target.conversationId ?? null,
    });

  if (error) {
    if (error.code === '22P02' || error.code === '23503') return 'unavailable';
    throw error;
  }

  if (data === 'submitted') telemetry.track('listing_reported', 'report', undefined, { result_status: 'submitted' });
  return typeof data === 'string' && KNOWN_RESULTS.has(data as ReportSubmissionStatus)
    ? data as ReportSubmissionStatus
    : 'invalid_input';
}

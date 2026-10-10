import { useCallback, useRef, useState } from 'react';

import { submitContentReport } from '@/features/reports/services/reportRepository';
import {
  REPORT_DETAILS_MAX_LENGTH,
  type ReportReason,
  type ReportTarget,
} from '@/features/reports/types/report';

interface ReportSubmissionResult {
  message: string;
  success: boolean;
}

export function useReportSubmission() {
  const [submitting, setSubmitting] = useState(false);
  const submissionLocked = useRef(false);

  const submit = useCallback(async (
    target: ReportTarget,
    reason: ReportReason | null,
    details: string,
  ): Promise<ReportSubmissionResult> => {
    if (submissionLocked.current) {
      return { message: 'A report is already being submitted.', success: false };
    }
    if (!reason) return { message: 'Select a reason', success: false };

    const normalizedDetails = details.trim();
    if (reason === 'other' && !normalizedDetails) {
      return { message: 'Add details for “Other”', success: false };
    }
    if (normalizedDetails.length > REPORT_DETAILS_MAX_LENGTH) {
      return {
        message: `Keep details to ${REPORT_DETAILS_MAX_LENGTH} characters or fewer.`,
        success: false,
      };
    }

    submissionLocked.current = true;
    setSubmitting(true);
    try {
      const result = await submitContentReport(target, reason, normalizedDetails);
      if (result === 'submitted') return { message: 'Report submitted', success: true };
      if (result === 'duplicate') {
        return { message: 'You already reported this', success: false };
      }
      if (result === 'unavailable') {
        return { message: 'This content is no longer available', success: false };
      }
      return { message: 'Could not submit report', success: false };
    } catch {
      return { message: 'Could not submit report', success: false };
    } finally {
      submissionLocked.current = false;
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting };
}


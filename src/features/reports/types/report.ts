export type ReportType = 'listing' | 'seller' | 'message' | 'review';

export type ListingReportReason =
  | 'scam'
  | 'prohibited_item'
  | 'counterfeit'
  | 'misleading'
  | 'duplicate'
  | 'inappropriate'
  | 'other';

export type SellerReportReason =
  | 'scam'
  | 'harassment'
  | 'impersonation'
  | 'suspicious_activity'
  | 'other';

export type MessageReportReason =
  | 'harassment'
  | 'spam'
  | 'scam'
  | 'inappropriate'
  | 'other';

export type ReportReason =
  | ListingReportReason
  | SellerReportReason
  | MessageReportReason;

export interface ReportTarget {
  type: ReportType;
  targetId: string;
  conversationId?: string;
}

export interface ReportReasonOption {
  label: string;
  value: ReportReason;
}

export type ReportSubmissionStatus =
  | 'submitted'
  | 'duplicate'
  | 'invalid_input'
  | 'invalid_target'
  | 'unavailable';

export const REPORT_DETAILS_MAX_LENGTH = 500;

export const REPORT_REASONS: Record<ReportType, ReportReasonOption[]> = {
  review: [
    { label: 'Harassment', value: 'harassment' },
    { label: 'Spam', value: 'spam' },
    { label: 'Scam', value: 'scam' },
    { label: 'Inappropriate content', value: 'inappropriate' },
    { label: 'Other', value: 'other' },
  ],
  listing: [
    { label: 'Scam', value: 'scam' },
    { label: 'Prohibited item', value: 'prohibited_item' },
    { label: 'Counterfeit', value: 'counterfeit' },
    { label: 'Misleading information', value: 'misleading' },
    { label: 'Duplicate listing', value: 'duplicate' },
    { label: 'Inappropriate content', value: 'inappropriate' },
    { label: 'Other', value: 'other' },
  ],
  seller: [
    { label: 'Scam', value: 'scam' },
    { label: 'Harassment', value: 'harassment' },
    { label: 'Impersonation', value: 'impersonation' },
    { label: 'Suspicious activity', value: 'suspicious_activity' },
    { label: 'Other', value: 'other' },
  ],
  message: [
    { label: 'Harassment', value: 'harassment' },
    { label: 'Spam', value: 'spam' },
    { label: 'Scam', value: 'scam' },
    { label: 'Inappropriate content', value: 'inappropriate' },
    { label: 'Other', value: 'other' },
  ],
};

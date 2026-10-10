export type ConnectOnboardingStatus =
  | 'not_created'
  | 'created'
  | 'onboarding_incomplete'
  | 'details_submitted_pending'
  | 'enabled'
  | 'restricted'
  | 'disabled';

export type TransferCapabilityStatus = 'inactive' | 'pending' | 'active' | 'restricted';

export interface SellerPayoutStatus {
  onboardingStatus: ConnectOnboardingStatus;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  transferCapabilityStatus: TransferCapabilityStatus | null;
  needsOnboarding: boolean;
  disabledReason: string | null;
}

export interface ConnectOnboardingLink {
  url: string;
  expiresAt: number;
}

import { requireSupabase } from '@/lib/supabase/client';
import type {
  ConnectOnboardingLink,
  ConnectOnboardingStatus,
  SellerPayoutStatus,
  TransferCapabilityStatus,
} from '@/features/payments/types/connect';
import { telemetry } from '@/services/telemetry';

const onboardingStatuses = new Set<ConnectOnboardingStatus>([
  'not_created',
  'created',
  'onboarding_incomplete',
  'details_submitted_pending',
  'enabled',
  'restricted',
  'disabled',
]);
const transferStatuses = new Set<TransferCapabilityStatus>([
  'inactive', 'pending', 'active', 'restricted',
]);

const asStatus = (value: unknown): SellerPayoutStatus => {
  if (!value || typeof value !== 'object') throw new Error('INVALID_CONNECT_RESPONSE');
  const row = value as Record<string, unknown>;
  if (!onboardingStatuses.has(row.onboardingStatus as ConnectOnboardingStatus)) {
    throw new Error('INVALID_CONNECT_RESPONSE');
  }
  if (row.transferCapabilityStatus !== null
    && !transferStatuses.has(row.transferCapabilityStatus as TransferCapabilityStatus)) {
    throw new Error('INVALID_CONNECT_RESPONSE');
  }
  if (
    typeof row.detailsSubmitted !== 'boolean'
    || typeof row.chargesEnabled !== 'boolean'
    || typeof row.payoutsEnabled !== 'boolean'
    || typeof row.needsOnboarding !== 'boolean'
    || (row.disabledReason !== null && typeof row.disabledReason !== 'string')
  ) throw new Error('INVALID_CONNECT_RESPONSE');

  return row as unknown as SellerPayoutStatus;
};

const invokeStatus = async (
  functionName: 'connect-account-create-or-get' | 'connect-account-refresh',
) => {
  const { data, error } = await requireSupabase().functions.invoke(functionName, {
    body: {},
  });
  if (error) throw new Error('CONNECT_FUNCTION_FAILED');
  return asStatus(data);
};

export const createOrGetConnectAccount = () =>
  invokeStatus('connect-account-create-or-get');

export const refreshConnectAccount = () =>
  invokeStatus('connect-account-refresh').then((status) => {
    if (status.onboardingStatus === 'enabled') telemetry.track('stripe_onboarding_completed', 'seller');
    return status;
  });

export async function createConnectOnboardingLink(): Promise<ConnectOnboardingLink> {
  const { data, error } = await requireSupabase().functions.invoke('connect-onboarding-link', {
    body: {},
  });
  if (error || !data || typeof data !== 'object') throw new Error('CONNECT_LINK_FAILED');
  const result = data as Record<string, unknown>;
  if (
    typeof result.url !== 'string'
    || !result.url.startsWith('https://connect.stripe.com/')
    || typeof result.expiresAt !== 'number'
  ) throw new Error('INVALID_CONNECT_LINK');
  telemetry.track('stripe_onboarding_started', 'seller');
  return { url: result.url, expiresAt: result.expiresAt };
}

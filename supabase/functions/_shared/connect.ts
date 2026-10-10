import type { SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import Stripe from "npm:stripe@22.4.0";

export type OnboardingStatus =
  | "created"
  | "onboarding_incomplete"
  | "details_submitted_pending"
  | "enabled"
  | "restricted"
  | "disabled";

export type TransferCapabilityStatus =
  | "inactive"
  | "pending"
  | "active"
  | "restricted";

export interface SafeConnectStatus {
  onboardingStatus: OnboardingStatus | "not_created";
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  transferCapabilityStatus: TransferCapabilityStatus | null;
  needsOnboarding: boolean;
  disabledReason: string | null;
}

const safeDisabledReason = (
  rawReason: string | null | undefined,
  hasPastDue: boolean,
) => {
  const reason = rawReason?.toLowerCase() ?? "";
  if (reason.includes("rejected")) return "account_rejected";
  if (reason.includes("listed")) return "account_listed";
  if (reason.includes("closed")) return "account_closed";
  if (reason.includes("platform_paused")) return "platform_paused";
  if (hasPastDue || reason.includes("past_due")) return "requirements_past_due";
  if (reason) return "account_restricted";
  return null;
};

const transferStatus = (
  value: string | null | undefined,
): TransferCapabilityStatus => {
  if (value === "active") return "active";
  if (value === "pending") return "pending";
  if (value === "inactive") return "inactive";
  return "inactive";
};

export const notCreatedStatus = (): SafeConnectStatus => ({
  onboardingStatus: "not_created",
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  transferCapabilityStatus: null,
  needsOnboarding: true,
  disabledReason: null,
});

export const unavailableStatus = (): SafeConnectStatus => ({
  onboardingStatus: "disabled",
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  transferCapabilityStatus: "restricted",
  needsOnboarding: false,
  disabledReason: "account_unavailable",
});

export const mapStripeAccountStatus = (
  account: Stripe.Account,
): SafeConnectStatus => {
  const requirements = account.requirements;
  const currentlyDue = requirements?.currently_due ?? [];
  const pendingVerification = requirements?.pending_verification ?? [];
  const pastDue = requirements?.past_due ?? [];
  const disabledReason = safeDisabledReason(
    requirements?.disabled_reason,
    pastDue.length > 0,
  );
  const transfers = transferStatus(account.capabilities?.transfers);

  let onboardingStatus: OnboardingStatus;
  if (
    disabledReason === "account_rejected" || disabledReason === "account_closed"
  ) {
    onboardingStatus = "disabled";
  } else if (
    disabledReason || pastDue.length > 0 || transfers === "restricted"
  ) {
    onboardingStatus = "restricted";
  } else if (
    account.details_submitted &&
    account.payouts_enabled &&
    transfers === "active" &&
    currentlyDue.length === 0 &&
    pendingVerification.length === 0
  ) {
    onboardingStatus = "enabled";
  } else if (account.details_submitted || pendingVerification.length > 0) {
    onboardingStatus = "details_submitted_pending";
  } else if (currentlyDue.length > 0) {
    onboardingStatus = "onboarding_incomplete";
  } else {
    onboardingStatus = "created";
  }

  return {
    onboardingStatus,
    detailsSubmitted: account.details_submitted,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    transferCapabilityStatus: transfers,
    needsOnboarding: onboardingStatus === "created" ||
      onboardingStatus === "onboarding_incomplete" ||
      onboardingStatus === "restricted",
    disabledReason,
  };
};

export const persistConnectStatus = async (
  admin: SupabaseClient,
  userId: string,
  status: SafeConnectStatus,
) => {
  if (status.onboardingStatus === "not_created") return;
  const { error } = await admin
    .from("seller_payment_accounts")
    .update({
      onboarding_status: status.onboardingStatus,
      details_submitted: status.detailsSubmitted,
      charges_enabled: status.chargesEnabled,
      payouts_enabled: status.payoutsEnabled,
      transfer_capability_status: status.transferCapabilityStatus,
      disabled_reason: status.disabledReason,
    })
    .eq("user_id", userId);
  if (error) {
    const wrapped = new Error(`STATUS_PERSIST_${error.code ?? "FAILED"}`, {
      cause: error,
    }) as Error & { code?: string };
    wrapped.code = error.code;
    throw wrapped;
  }
};

export const retrieveAndSyncAccount = async (
  stripe: Stripe,
  admin: SupabaseClient,
  userId: string,
  accountId: string,
) => {
  if (!/^acct_[a-zA-Z0-9]+$/.test(accountId)) {
    const status = unavailableStatus();
    await persistConnectStatus(admin, userId, status);
    return status;
  }

  const account = await stripe.accounts.retrieve(accountId);
  if ("deleted" in account && account.deleted) {
    const status = unavailableStatus();
    await persistConnectStatus(admin, userId, status);
    return status;
  }

  const status = mapStripeAccountStatus(account as Stripe.Account);
  await persistConnectStatus(admin, userId, status);
  return status;
};

export const databaseStatus = (
  row: Record<string, unknown>,
): SafeConnectStatus => ({
  onboardingStatus: row.onboarding_status as OnboardingStatus,
  detailsSubmitted: row.details_submitted === true,
  chargesEnabled: row.charges_enabled === true,
  payoutsEnabled: row.payouts_enabled === true,
  transferCapabilityStatus: row.transfer_capability_status as
    | TransferCapabilityStatus
    | null,
  needsOnboarding: row.onboarding_status === "created" ||
    row.onboarding_status === "onboarding_incomplete" ||
    row.onboarding_status === "restricted",
  disabledReason: typeof row.disabled_reason === "string"
    ? row.disabled_reason
    : null,
});

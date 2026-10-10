import {
  notCreatedStatus,
  retrieveAndSyncAccount,
  unavailableStatus,
} from "../_shared/connect.ts";
import {
  accountSuffix,
  json,
  optionsResponse,
  safeErrorCode,
} from "../_shared/http.ts";
import {
  createServerClients,
  requireAuthenticatedUser,
} from "../_shared/server.ts";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { admin, stripe } = createServerClients();
    const user = await requireAuthenticatedUser(request, admin);
    const { data, error } = await admin
      .from("seller_payment_accounts")
      .select("stripe_account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(`ACCOUNT_LOOKUP_${error.code ?? "FAILED"}`);
    if (!data?.stripe_account_id) return json(notCreatedStatus());

    try {
      const status = await retrieveAndSyncAccount(
        stripe,
        admin,
        user.id,
        data.stripe_account_id,
      );
      console.info("Connect account refreshed", {
        operation: "connect_account_refresh",
        userId: user.id,
        accountSuffix: accountSuffix(data.stripe_account_id),
        onboardingStatus: status.onboardingStatus,
      });
      return json(status);
    } catch (error) {
      if (safeErrorCode(error) === "resource_missing") {
        const status = unavailableStatus();
        const { error: updateError } = await admin
          .from("seller_payment_accounts")
          .update({
            onboarding_status: status.onboardingStatus,
            details_submitted: false,
            charges_enabled: false,
            payouts_enabled: false,
            transfer_capability_status: "restricted",
            disabled_reason: status.disabledReason,
          })
          .eq("user_id", user.id);
        if (updateError) throw updateError;
        return json(status);
      }
      throw error;
    }
  } catch (error) {
    const code = safeErrorCode(error);
    const authFailure = error instanceof Error &&
      error.message === "AUTH_REQUIRED";
    console.error("Connect account refresh failed", {
      operation: "connect_account_refresh",
      errorCode: code,
    });
    return json(
      {
        error: authFailure
          ? "Authentication required."
          : "Could not refresh payout status.",
      },
      authFailure ? 401 : 502,
    );
  }
});

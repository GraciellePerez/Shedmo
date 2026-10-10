import {
  databaseStatus,
  retrieveAndSyncAccount,
  unavailableStatus,
} from "../_shared/connect.ts";
import { json, optionsResponse, safeErrorCode } from "../_shared/http.ts";
import {
  createStripeClient,
  createSupabaseAdminClient,
  requireAuthenticatedUser,
} from "../_shared/server.ts";

const ACCOUNT_CREATE_VERSION = "v1";
const DIAGNOSTICS_ENABLED =
  Deno.env.get("CONNECT_DIAGNOSTIC_LOGGING")?.trim().toLowerCase() === "true";

type DiagnosticStage =
  | "request_start"
  | "jwt_authentication"
  | "supabase_client_creation"
  | "authenticated_user_lookup"
  | "seller_payment_accounts_lookup"
  | "seller_payment_accounts_upsert"
  | "stripe_client_creation"
  | "stripe_accounts_create"
  | "database_stripe_account_update"
  | "retrieve_and_sync_account";

const diagnostic = (
  stage: DiagnosticStage,
  event: "before" | "after",
) => {
  if (!DIAGNOSTICS_ENABLED) return;
  console.info("Connect account diagnostic", {
    operation: "connect_account_create_or_get",
    stage,
    event,
  });
};

const errorMetadata = (error: unknown, stage: DiagnosticStage) => {
  const value = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  const rawError = value.raw && typeof value.raw === "object"
    ? value.raw as Record<string, unknown>
    : {};
  const cause = value.cause && typeof value.cause === "object"
    ? value.cause as Record<string, unknown>
    : {};
  const lastResponse = value.lastResponse &&
      typeof value.lastResponse === "object"
    ? value.lastResponse as Record<string, unknown>
    : {};
  const message = error instanceof Error ? error.message : "";
  const status = typeof value.statusCode === "number"
    ? value.statusCode
    : typeof value.status === "number"
    ? value.status
    : typeof rawError.statusCode === "number"
    ? rawError.statusCode
    : null;
  const stripeCode = typeof rawError.code === "string"
    ? safeErrorCode(rawError)
    : value.type === "StripeError" || message.startsWith("Stripe")
    ? safeErrorCode(error)
    : null;
  const candidatePostgresCode = typeof value.code === "string"
    ? value.code
    : typeof cause.code === "string"
    ? cause.code
    : null;
  const postgresCode = candidatePostgresCode &&
      /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(candidatePostgresCode)
    ? candidatePostgresCode
    : null;
  const messageCategory = message === "AUTH_REQUIRED"
    ? "authentication_required"
    : message.startsWith("Missing server configuration:")
    ? "missing_server_configuration"
    : message.startsWith("ACCOUNT_LOOKUP_")
    ? "account_lookup_failed"
    : message.startsWith("ACCOUNT_PLACEHOLDER_")
    ? "account_upsert_failed"
    : message.startsWith("ACCOUNT_STORE_")
    ? "account_store_failed"
    : message.startsWith("STATUS_PERSIST_")
    ? "status_persist_failed"
    : stripeCode
    ? "stripe_request_failed"
    : postgresCode
    ? "database_request_failed"
    : "unexpected_error";

  return {
    stage,
    errorType: typeof value.type === "string"
      ? value.type.slice(0, 100)
      : typeof error,
    errorName: error instanceof Error ? error.name.slice(0, 100) : null,
    httpStatus: status,
    stripeErrorCode: stripeCode,
    stripeRequestId: typeof value.requestId === "string"
      ? value.requestId.slice(0, 100)
      : typeof rawError.requestId === "string"
      ? rawError.requestId.slice(0, 100)
      : typeof rawError.request_id === "string"
      ? rawError.request_id.slice(0, 100)
      : typeof lastResponse.requestId === "string"
      ? lastResponse.requestId.slice(0, 100)
      : null,
    postgresErrorCode: postgresCode,
    messageCategory,
  };
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let stage: DiagnosticStage = "request_start";
  try {
    stage = "supabase_client_creation";
    diagnostic(stage, "before");
    const admin = createSupabaseAdminClient();
    diagnostic(stage, "after");

    const user = await requireAuthenticatedUser(
      request,
      admin,
      (nextStage, event) => {
        stage = nextStage;
        diagnostic(nextStage, event);
      },
    );

    stage = "stripe_client_creation";
    diagnostic(stage, "before");
    const stripe = createStripeClient();
    diagnostic(stage, "after");
    const lookup = async () => {
      stage = "seller_payment_accounts_lookup";
      diagnostic(stage, "before");
      const result = await admin
        .from("seller_payment_accounts")
        .select(
          "stripe_account_id,onboarding_status,details_submitted,charges_enabled,payouts_enabled,transfer_capability_status,disabled_reason",
        )
        .eq("user_id", user.id)
        .maybeSingle();
      if (!result.error) diagnostic(stage, "after");
      return result;
    };

    let { data: existing, error: lookupError } = await lookup();
    if (lookupError) {
      const wrapped = new Error(
        `ACCOUNT_LOOKUP_${lookupError.code ?? "FAILED"}`,
        { cause: lookupError },
      ) as Error & { code?: string };
      wrapped.code = lookupError.code;
      throw wrapped;
    }

    if (existing?.stripe_account_id) {
      try {
        stage = "retrieve_and_sync_account";
        diagnostic(stage, "before");
        const status = await retrieveAndSyncAccount(
          stripe,
          admin,
          user.id,
          existing.stripe_account_id,
        );
        diagnostic(stage, "after");
        return json(status);
      } catch (error) {
        if (safeErrorCode(error) !== "resource_missing") throw error;
        const status = unavailableStatus();
        const { error: updateError } = await admin
          .from("seller_payment_accounts")
          .update({
            onboarding_status: "disabled",
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
    }

    if (!existing) {
      stage = "seller_payment_accounts_upsert";
      diagnostic(stage, "before");
      const { error: placeholderError } = await admin
        .from("seller_payment_accounts")
        .upsert({
          user_id: user.id,
          account_type: "express",
          onboarding_status: "created",
        }, { onConflict: "user_id", ignoreDuplicates: true });
      if (placeholderError) {
        const wrapped = new Error(
          `ACCOUNT_PLACEHOLDER_${placeholderError.code ?? "FAILED"}`,
          { cause: placeholderError },
        ) as Error & { code?: string };
        wrapped.code = placeholderError.code;
        throw wrapped;
      }
      diagnostic(stage, "after");
    } else if (existing.onboarding_status === "disabled") {
      return json(databaseStatus(existing));
    }

    // Give a concurrent winner a brief chance to persist the stable Stripe ID.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await wait(200 * (attempt + 1));
      const result = await lookup();
      if (result.error) throw result.error;
      existing = result.data;
      if (existing?.stripe_account_id) {
        stage = "retrieve_and_sync_account";
        diagnostic(stage, "before");
        const status = await retrieveAndSyncAccount(
          stripe,
          admin,
          user.id,
          existing.stripe_account_id,
        );
        diagnostic(stage, "after");
        return json(status);
      }
    }

    stage = "stripe_accounts_create";
    diagnostic(stage, "before");
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: user.email,
      capabilities: { transfers: { requested: true } },
      business_profile: {
        product_description:
          "Seller of eligible physical goods through Shedmo.",
      },
      metadata: {
        supabase_user_id: user.id,
        integration: "marketplace_seller_v1",
      },
    }, {
      idempotencyKey: `connect-account:${user.id}:${ACCOUNT_CREATE_VERSION}`,
    });
    diagnostic(stage, "after");

    stage = "database_stripe_account_update";
    diagnostic(stage, "before");
    const { data: stored, error: storeError } = await admin
      .from("seller_payment_accounts")
      .update({ stripe_account_id: account.id })
      .eq("user_id", user.id)
      .is("stripe_account_id", null)
      .select("stripe_account_id")
      .maybeSingle();
    if (storeError) {
      const wrapped = new Error(
        `ACCOUNT_STORE_${storeError.code ?? "FAILED"}`,
        { cause: storeError },
      ) as Error & { code?: string };
      wrapped.code = storeError.code;
      throw wrapped;
    }
    diagnostic(stage, "after");

    if (!stored?.stripe_account_id) {
      const current = await lookup();
      if (current.error || !current.data?.stripe_account_id) {
        throw new Error("ACCOUNT_STORE_CONFLICT");
      }
      if (current.data.stripe_account_id !== account.id) {
        console.warn(
          "Connect account creation converged on an existing mapping",
          {
            operation: "connect_account_create_or_get",
          },
        );
      }
      stage = "retrieve_and_sync_account";
      diagnostic(stage, "before");
      const currentStatus = await retrieveAndSyncAccount(
        stripe,
        admin,
        user.id,
        current.data.stripe_account_id,
      );
      diagnostic(stage, "after");
      return json(currentStatus);
    }

    stage = "retrieve_and_sync_account";
    diagnostic(stage, "before");
    const status = await retrieveAndSyncAccount(
      stripe,
      admin,
      user.id,
      account.id,
    );
    diagnostic(stage, "after");
    console.info("Connect Express account ready", {
      operation: "connect_account_create_or_get",
      onboardingStatus: status.onboardingStatus,
    });
    return json(status);
  } catch (error) {
    const code = safeErrorCode(error);
    const authFailure = error instanceof Error &&
      error.message === "AUTH_REQUIRED";
    if (DIAGNOSTICS_ENABLED) {
      console.error("Connect account create/get failed", {
        operation: "connect_account_create_or_get",
        errorCode: code,
        ...errorMetadata(error, stage),
      });
    } else {
      console.error("Connect account create/get failed", {
        operation: "connect_account_create_or_get",
        errorCode: code,
      });
    }
    return json(
      {
        error: authFailure
          ? "Authentication required."
          : "Could not start payout setup.",
      },
      authFailure ? 401 : 502,
    );
  }
});

import { retrieveAndSyncAccount } from "../_shared/connect.ts";
import { json, optionsResponse, safeErrorCode } from "../_shared/http.ts";
import {
  createServerClients,
  requireAuthenticatedUser,
} from "../_shared/server.ts";

const onboardingUrl = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`MISSING_${name}`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`INVALID_${name}`);
  }

  const localHttp = parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new Error(`INSECURE_${name}`);
  }
  return value;
};

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
    if (!data?.stripe_account_id) {
      return json({ error: "Set up a seller payout account first." }, 409);
    }

    const status = await retrieveAndSyncAccount(
      stripe,
      admin,
      user.id,
      data.stripe_account_id,
    );
    if (status.onboardingStatus === "disabled") {
      return json(
        { error: "Payout setup is unavailable. Contact support." },
        409,
      );
    }

    const link = await stripe.accountLinks.create({
      account: data.stripe_account_id,
      refresh_url: onboardingUrl("CONNECT_ONBOARDING_REFRESH_URL"),
      return_url: onboardingUrl("CONNECT_ONBOARDING_RETURN_URL"),
      type: "account_onboarding",
      collection_options: { fields: "eventually_due" },
    });

    console.info("Connect onboarding link created", {
      operation: "connect_onboarding_link",
      expiresAt: link.expires_at,
      stripeRequestId: link.lastResponse?.requestId ?? null,
    });
    return json({ url: link.url, expiresAt: link.expires_at });
  } catch (error) {
    const code = safeErrorCode(error);
    const authFailure = error instanceof Error &&
      error.message === "AUTH_REQUIRED";
    console.error("Connect onboarding link failed", {
      operation: "connect_onboarding_link",
      errorCode: code,
    });
    return json(
      {
        error: authFailure
          ? "Authentication required."
          : "Could not create payout setup link.",
      },
      authFailure ? 401 : 502,
    );
  }
});

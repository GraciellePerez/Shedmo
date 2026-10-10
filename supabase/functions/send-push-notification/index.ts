import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.111.0";

interface WebhookPayload {
  type?: unknown;
  schema?: unknown;
  table?: unknown;
  record?: { id?: unknown };
}

interface NotificationRecord {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: "new_message" | "listing_favorited" | "local_sale_confirmation";
  title: string | null;
  listing_id: string | null;
  conversation_id: string | null;
}

interface PushToken {
  id: string;
  expo_push_token: string;
  platform: "ios" | "android";
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ClaimedMessage {
  token: PushToken;
  claimToken: string;
  message: {
    to: string;
    sound: "default";
    channelId: "marketplace";
    title: string;
    body: string;
    data: {
      type: NotificationRecord["type"];
      notificationId: string;
      conversationId: string | null;
      listingId: string | null;
      actorId: string | null;
    };
  };
}

const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;
const EXPO_TIMEOUT_MS = 10_000;
const MAX_HTTP_ATTEMPTS = 3;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const safeTitle = (title: string | null) => {
  const normalized = typeof title === "string" ? title.trim() : "";
  return (normalized || "Shedmo update").slice(0, 80);
};

const tokenSuffix = (token: string) => token.slice(-8);

const logPostgrestError = (
  label: string,
  error: {
    code?: string;
  },
  context: Record<string, unknown> = {},
) => {
  console.error(label, {
    ...context,
    code: error.code ?? null,
  });
};

const isExpoTicket = (value: unknown): value is ExpoTicket => {
  if (!value || typeof value !== "object") return false;
  const ticket = value as Record<string, unknown>;
  if (ticket.status !== "ok" && ticket.status !== "error") return false;
  if (ticket.id !== undefined && typeof ticket.id !== "string") return false;
  if (ticket.details !== undefined) {
    if (!ticket.details || typeof ticket.details !== "object") return false;
    const error = (ticket.details as Record<string, unknown>).error;
    if (error !== undefined && typeof error !== "string") return false;
  }
  return true;
};

const updateClaim = async (
  client: SupabaseClient,
  notificationId: string,
  tokenId: string,
  claimToken: string,
  values: {
    status: "sent" | "error";
    expo_ticket_id?: string | null;
    next_attempt_at: string | null;
    last_error_code: string | null;
  },
) => {
  const { data, error } = await client
    .from("push_delivery_claims")
    .update(values)
    .eq("notification_id", notificationId)
    .eq("push_token_id", tokenId)
    .eq("claim_token", claimToken)
    .select("notification_id");

  if (error) {
    console.error("Push claim update failed", { notificationId, tokenId });
    return false;
  }

  if (!data?.length) {
    console.warn("Push claim update skipped because its lease is stale", {
      notificationId,
    });
    return false;
  }

  return true;
};

const markRetryable = async (
  client: SupabaseClient,
  notificationId: string,
  claimed: ClaimedMessage[],
  errorCode: string,
) => {
  const nextAttemptAt = new Date(Date.now() + 60_000).toISOString();
  await Promise.all(
    claimed.map(({ token, claimToken }) =>
      updateClaim(client, notificationId, token.id, claimToken, {
        status: "error",
        next_attempt_at: nextAttemptAt,
        last_error_code: errorCode,
      })
    ),
  );
};

const fetchExpo = async (
  messages: ClaimedMessage["message"][],
): Promise<{ response: Response; body: unknown }> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPO_TIMEOUT_MS);
    try {
      const response = await fetch(EXPO_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(messages),
        signal: controller.signal,
      });

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      clearTimeout(timeout);

      if (response.status !== 429 && response.status < 500) {
        return { response, body };
      }
      lastError = new Error(`Temporary Expo HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
    }

    if (attempt + 1 < MAX_HTTP_ATTEMPTS) {
      const exponentialDelay = 300 * 2 ** attempt;
      const jitter = Math.floor(Math.random() * 200);
      await sleep(exponentialDelay + jitter);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Expo request failed");
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  if (
    !expectedSecret ||
    request.headers.get("x-push-webhook-secret") !== expectedSecret
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = (await request.json()) as WebhookPayload;
  } catch {
    return json({ error: "Malformed JSON" }, 400);
  }

  const rawNotificationId = payload.record?.id;
  const notificationId = typeof rawNotificationId === "string"
    ? rawNotificationId.trim()
    : null;

  if (
    payload.type !== "INSERT" ||
    payload.schema !== "public" ||
    payload.table !== "notifications" ||
    notificationId === null ||
    !UUID_PATTERN.test(notificationId)
  ) {
    return json({ error: "Invalid webhook payload" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) {
    console.error("Push function server configuration missing", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRole),
    });
    return json({ error: "Server configuration missing" }, 500);
  }

  const client = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let notification: NotificationRecord | null = null;
  let notificationError: {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  } | null = null;

  // Database Webhooks are asynchronous, but a short bounded retry also covers
  // a notification row that is not visible to PostgREST on the first request.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await client
        .schema("public")
        .from("notifications")
        .select("id,user_id,actor_id,type,title,listing_id,conversation_id")
        .eq("id", notificationId)
        .maybeSingle();
      notification = result.data as NotificationRecord | null;
      notificationError = result.error;
    } catch {
      notificationError = {
        code: "CLIENT_EXCEPTION",
      };
    }

    if (notification) break;
    if (attempt < 2) await sleep(150 * 2 ** attempt);
  }

  if (notificationError) {
    logPostgrestError("Notification lookup failed", notificationError, {
      notificationId,
      schema: "public",
      table: "notifications",
    });
    return json({ error: "Notification lookup failed" }, 500);
  }
  if (!notification) {
    console.warn("Notification lookup returned no row", { notificationId });
    return json({ error: "Notification unavailable" }, 404);
  }
  if (
    notification.type !== "new_message" &&
    notification.type !== "listing_favorited" &&
    notification.type !== "local_sale_confirmation"
  ) {
    return json({ skipped: true });
  }

  if (notification.type === "local_sale_confirmation") {
    const { data: confirmedSale, error: confirmedSaleError } = await client
      .schema("public")
      .from("local_sale_confirmations")
      .select("id")
      .eq("listing_id", notification.listing_id)
      .eq("conversation_id", notification.conversation_id)
      .eq("seller_id", notification.user_id)
      .eq("buyer_id", notification.actor_id)
      .eq("status", "confirmed")
      .maybeSingle();
    if (confirmedSaleError) {
      logPostgrestError("Local sale confirmation lookup failed", confirmedSaleError, {
        notificationId,
      });
      return json({ error: "Local sale confirmation lookup failed" }, 500);
    }
    if (!confirmedSale) return json({ skipped: true });
  }

  const { data: tokenData, error: tokenError } = await client
    .schema("public")
    .from("push_tokens")
    .select("id,expo_push_token,platform")
    .eq("user_id", notification.user_id)
    .is("disabled_at", null);
  if (tokenError) {
    logPostgrestError("Push token lookup failed", tokenError, {
      notificationId,
      schema: "public",
      table: "push_tokens",
    });
    return json({ error: "Token lookup failed" }, 500);
  }

  const tokens = (tokenData ?? []) as PushToken[];
  if (!tokens.length) return json({ delivered: 0 });

  const genericBody = notification.type === "new_message"
    ? "You received a new message."
    : notification.type === "listing_favorited"
    ? "Someone saved your listing."
    : "Someone completed a local sale for your listing.";
  const claimed: ClaimedMessage[] = [];

  for (const token of tokens) {
    const { data: acquired, error } = await client.rpc(
      "acquire_push_delivery_claim",
      {
        p_notification_id: notification.id,
        p_push_token_id: token.id,
      },
    );
    if (error) {
      console.error("Push claim acquisition failed", {
        notificationId: notification.id,
        tokenSuffix: tokenSuffix(token.expo_push_token),
      });
      continue;
    }
    if (typeof acquired === "string" && UUID_PATTERN.test(acquired)) {
      claimed.push({
        token,
        claimToken: acquired,
        message: {
          to: token.expo_push_token,
          sound: "default",
          channelId: "marketplace",
          title: safeTitle(notification.title),
          body: genericBody,
          data: {
            type: notification.type,
            notificationId: notification.id,
            conversationId: notification.conversation_id,
            listingId: notification.listing_id,
            actorId: notification.type === "local_sale_confirmation"
              ? null
              : notification.actor_id,
          },
        },
      });
    }
  }

  if (!claimed.length) {
    return json({ delivered: 0, duplicateOrPending: true });
  }

  let delivered = 0;
  let temporaryFailures = 0;
  let permanentFailures = 0;

  for (let start = 0; start < claimed.length; start += EXPO_BATCH_SIZE) {
    const batch = claimed.slice(start, start + EXPO_BATCH_SIZE);
    let response: Response;
    let result: unknown;

    try {
      ({ response, body: result } = await fetchExpo(
        batch.map(({ message }) => message),
      ));
    } catch (error) {
      temporaryFailures += batch.length;
      await markRetryable(client, notification.id, batch, "EXPO_TEMPORARY");
      console.error("Temporary Expo request failure", {
        notificationId: notification.id,
        batchSize: batch.length,
        reason: error instanceof DOMException && error.name === "AbortError"
          ? "timeout"
          : "network_or_server",
      });
      continue;
    }

    if (!response.ok) {
      permanentFailures += batch.length;
      const errorCode = `EXPO_HTTP_${response.status}`;
      await Promise.all(
        batch.map(({ token, claimToken }) =>
          updateClaim(client, notification.id, token.id, claimToken, {
            status: "error",
            next_attempt_at: null,
            last_error_code: errorCode,
          })
        ),
      );
      console.error("Permanent Expo HTTP failure", {
        notificationId: notification.id,
        batchSize: batch.length,
        status: response.status,
      });
      continue;
    }

    const tickets = result &&
        typeof result === "object" &&
        Array.isArray((result as { data?: unknown }).data)
      ? (result as { data: unknown[] }).data
      : null;

    for (let index = 0; index < batch.length; index += 1) {
      const claimedMessage = batch[index];
      const rawTicket = tickets?.[index];

      if (!isExpoTicket(rawTicket)) {
        temporaryFailures += 1;
        await markRetryable(
          client,
          notification.id,
          [claimedMessage],
          "EXPO_MALFORMED_TICKET",
        );
        console.error("Malformed or missing Expo ticket", {
          notificationId: notification.id,
          batchIndex: index,
          tokenSuffix: tokenSuffix(claimedMessage.token.expo_push_token),
        });
        continue;
      }

      if (rawTicket.status === "ok" && rawTicket.id) {
        const claimUpdated = await updateClaim(
          client,
          notification.id,
          claimedMessage.token.id,
          claimedMessage.claimToken,
          {
            status: "sent",
            expo_ticket_id: rawTicket.id,
            next_attempt_at: null,
            last_error_code: null,
          },
        );
        if (claimUpdated) delivered += 1;
      } else if (rawTicket.status === "error") {
        const safeErrorCode = rawTicket.details?.error?.slice(0, 80) ||
          "EXPO_TICKET_ERROR";
        const claimUpdated = await updateClaim(
          client,
          notification.id,
          claimedMessage.token.id,
          claimedMessage.claimToken,
          {
            status: "error",
            expo_ticket_id: rawTicket.id ?? null,
            next_attempt_at: null,
            last_error_code: safeErrorCode,
          },
        );

        if (claimUpdated) permanentFailures += 1;

        if (
          claimUpdated &&
          rawTicket.details?.error === "DeviceNotRegistered"
        ) {
          await client
            .from("push_tokens")
            .update({ disabled_at: new Date().toISOString() })
            .eq("id", claimedMessage.token.id);
          console.warn("Disabled DeviceNotRegistered push token", {
            notificationId: notification.id,
            tokenSuffix: tokenSuffix(claimedMessage.token.expo_push_token),
            errorCode: safeErrorCode,
          });
        } else {
          console.error("Expo push ticket error", {
            notificationId: notification.id,
            tokenSuffix: tokenSuffix(claimedMessage.token.expo_push_token),
            errorCode: safeErrorCode,
          });
        }
      } else {
        temporaryFailures += 1;
        await markRetryable(
          client,
          notification.id,
          [claimedMessage],
          "EXPO_INCOMPLETE_TICKET",
        );
        console.error("Incomplete Expo ticket marked retryable", {
          notificationId: notification.id,
          tokenSuffix: tokenSuffix(claimedMessage.token.expo_push_token),
          errorCode: "EXPO_INCOMPLETE_TICKET",
        });
      }
    }
  }

  if (temporaryFailures > 0) {
    return json(
      { delivered, temporaryFailures, permanentFailures },
      502,
    );
  }
  return json({ delivered, temporaryFailures, permanentFailures });
});

import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

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
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) {
    return json({ error: "Server configuration missing" }, 500);
  }
  const client = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error } = await client.from("push_delivery_claims")
    .select(
      "notification_id,push_token_id,expo_ticket_id,push_tokens!inner(expo_push_token,platform)",
    )
    .eq("status", "sent")
    .not("expo_ticket_id", "is", null)
    .limit(300);
  if (error) return json({ error: "Receipt claims unavailable" }, 500);
  if (!claims?.length) return json({ checked: 0 });

  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ids: claims.map((claim) => claim.expo_ticket_id) }),
  });
  if (!response.ok) return json({ error: "Expo receipt request failed" }, 502);
  const result = await response.json() as {
    data?: Record<
      string,
      { status: "ok" | "error"; details?: { error?: string } }
    >;
  };
  for (const claim of claims) {
    const receipt = result.data?.[claim.expo_ticket_id as string];
    if (!receipt) continue;
    await client.from("push_delivery_claims").update({
      status: receipt.status === "ok" ? "delivered" : "error",
      checked_at: new Date().toISOString(),
    }).eq("notification_id", claim.notification_id).eq(
      "push_token_id",
      claim.push_token_id,
    );
    if (
      receipt.status === "error" &&
      receipt.details?.error === "DeviceNotRegistered"
    ) {
      await client.from("push_tokens").update({
        disabled_at: new Date().toISOString(),
      })
        .eq("id", claim.push_token_id);
    }
    const relatedToken = claim.push_tokens as unknown as {
      expo_push_token: string;
      platform: string;
    };
    console.log(JSON.stringify({
      ticketStatus: receipt.status,
      receiptErrorCode: receipt.details?.error ?? null,
      platform: relatedToken.platform,
      tokenSuffix: relatedToken.expo_push_token.slice(-8),
    }));
  }
  return json({ checked: claims.length });
});

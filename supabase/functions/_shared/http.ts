export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

export const json = (
  body: unknown,
  status = 200,
  includeCors = true,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(includeCors ? corsHeaders : {}),
    },
  });

export const optionsResponse = () =>
  new Response("ok", { headers: corsHeaders });

export const safeErrorCode = (error: unknown) => {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const value = error as { code?: unknown; type?: unknown };
  const candidate = typeof value.code === "string"
    ? value.code
    : typeof value.type === "string"
    ? value.type
    : "UNKNOWN";
  return candidate.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 100) || "UNKNOWN";
};

export const accountSuffix = (accountId: string) => accountId.slice(-6);

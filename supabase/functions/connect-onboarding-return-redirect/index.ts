const APP_RETURN_URL = "shedmo:///settings/payouts/return";

const noStoreHeaders = {
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
};

Deno.serve((request: Request) => {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...noStoreHeaders, allow: "GET" },
    });
  }

  return new Response(
    `<!doctype html><html><body><a href="${APP_RETURN_URL}">Return to Shedmo</a></body></html>`,
    {
      status: 303,
      headers: { ...noStoreHeaders, location: APP_RETURN_URL },
    },
  );
});

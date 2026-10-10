const APP_SCHEME = "shedmo:";

const payoutRoute = (path: string) => {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (normalized === "/settings/payouts/return") return normalized;
  if (normalized === "/settings/payouts/refresh") return normalized;
  return null;
};

const authRoute = (path: string) => path === "/auth/callback" || path === "/reset-password"
  ? path
  : null;

export function redirectSystemPath(
  { path }: { path: string; initial: boolean },
) {
  try {
    if (path.startsWith("/")) {
      const route = new URL(path, "https://app.local").pathname;
      return payoutRoute(route) ?? authRoute(route) ?? path;
    }

    const url = new URL(path);
    if (url.protocol !== APP_SCHEME) return path;

    const route = `/${
      [url.hostname, url.pathname]
        .map((part) => part.replace(/^\/+|\/+$/g, ""))
        .filter(Boolean)
        .join("/")
    }`;
    return payoutRoute(route) ?? authRoute(route) ?? path;
  } catch {
    return path;
  }
}

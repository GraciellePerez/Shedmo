export type PayoutCallbackRoute =
  | '/settings/payouts/return'
  | '/settings/payouts/refresh';

export type AppDeepLink =
  | { kind: 'payout'; route: PayoutCallbackRoute }
  | { kind: 'auth'; accessToken: string; refreshToken: string }
  | { kind: 'recovery'; accessToken: string; refreshToken: string }
  | { kind: 'invalid-recovery' }
  | { kind: 'other' };

const APP_SCHEME = 'shedmo:';

const appPath = (url: URL) => `/${[url.hostname, url.pathname]
  .map((part) => part.replace(/^\/+|\/+$/g, ''))
  .filter(Boolean)
  .join('/')}`.replace(/\/+$/, '');

export function classifyAppDeepLink(rawUrl: string): AppDeepLink {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== APP_SCHEME) return { kind: 'other' };

    const path = appPath(url);
    if (path === '/settings/payouts/return') {
      return { kind: 'payout', route: '/settings/payouts/return' };
    }
    if (path === '/settings/payouts/refresh') {
      return { kind: 'payout', route: '/settings/payouts/refresh' };
    }
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    const type = fragment.get('type') ?? url.searchParams.get('type');
    const accessToken = fragment.get('access_token') ??
      url.searchParams.get('access_token');
    const refreshToken = fragment.get('refresh_token') ??
      url.searchParams.get('refresh_token');
    if (path === '/auth/callback') {
      return type !== 'recovery' && accessToken && refreshToken
        ? { kind: 'auth', accessToken, refreshToken }
        : { kind: 'other' };
    }
    if (path !== '/reset-password') return { kind: 'other' };

    if (type !== 'recovery' || !accessToken || !refreshToken) {
      return { kind: 'invalid-recovery' };
    }
    return { kind: 'recovery', accessToken, refreshToken };
  } catch {
    return { kind: 'other' };
  }
}

export function navigationForDeepLink(
  link: AppDeepLink,
  sessionPresent: boolean,
) {
  if (link.kind === 'payout') {
    return sessionPresent ? link.route : '/(auth)';
  }
  if (link.kind === 'recovery') return '/reset-password';
  if (link.kind === 'auth') return sessionPresent ? '/(tabs)' : '/(auth)';
  return null;
}

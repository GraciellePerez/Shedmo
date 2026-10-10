import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { requireSupabase, supabase, supabaseConfigurationError } from '@/lib/supabase/client';
import type { AuthActionResult, DatabaseProfile, ProfileUpdateInput } from '@/features/auth/types/auth';
import { disablePushToken } from '@/features/notifications/services/pushTokenRepository';
import {
  clearStoredPushToken,
  getStoredPushToken,
} from '@/features/notifications/services/pushTokenStorage';
import {
  classifyAppDeepLink,
  type PayoutCallbackRoute,
} from '@/features/auth/deepLinkRouting';
import { telemetry } from '@/services/telemetry';
import { friendlyError, passwordUpdateError } from '@/features/auth/authErrors';
import { accountDeletionError } from '@/features/auth/accountDeletionError';

interface AuthStoreValue {
  configurationError: string | null;
  emailVerified: boolean;
  initializing: boolean;
  linkingReady: boolean;
  passwordRecoveryActive: boolean;
  pendingPayoutRoute: PayoutCallbackRoute | null;
  profile: DatabaseProfile | null;
  profileError: string | null;
  profileLoading: boolean;
  session: Session | null;
  signingOut: boolean;
  user: User | null;
  forgotPassword: (email: string) => Promise<AuthActionResult>;
  clearPasswordRecovery: () => void;
  consumePendingPayoutRoute: () => void;
  deleteAccount: () => Promise<AuthActionResult>;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<AuthActionResult>;
  signUp: (email: string, password: string, displayName: string, username: string) => Promise<AuthActionResult>;
  updatePassword: (password: string) => Promise<AuthActionResult>;
  updateProfile: (input: ProfileUpdateInput) => Promise<AuthActionResult>;
}

const AuthStoreContext = createContext<AuthStoreValue | null>(null);

export function AuthStoreProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [profile, setProfile] = useState<DatabaseProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [linkingReady, setLinkingReady] = useState(false);
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState(false);
  const [pendingPayoutRoute, setPendingPayoutRoute] =
    useState<PayoutCallbackRoute | null>(null);
  const operationInFlight = useRef(false);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!supabase) return;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const { data, error } = await supabase.rpc('get_my_profile_v1').eq('id', userId).maybeSingle();
      if (error) setProfileError(friendlyError(error.message));
      else if (!data) {
        setProfile(null);
        setProfileError('Your profile is still being prepared. Pull to retry in a moment.');
      } else setProfile(data as DatabaseProfile);
    } catch {
      setProfileError('Unable to load your profile. Check your connection and tap to retry.');
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setInitializing(false);
      return;
    }
    const client = supabase;
    let mounted = true;
    let authEventReceived = false;

    const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') setPasswordRecoveryActive(true);
      authEventReceived = true;
      setSession(nextSession);
      setInitializing(false);
      if (nextSession?.user.id) void fetchProfile(nextSession.user.id);
      else {
        setProfile(null);
        setProfileError(null);
      }
    });

    const restoreSession = async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (!mounted || authEventReceived) return;
        if (error) setProfileError(friendlyError(error.message));
        setSession(data.session);
        if (data.session?.user.id) void fetchProfile(data.session.user.id);
      } catch {
        if (mounted) setProfileError('Unable to restore your session. Please sign in again.');
      } finally {
        if (mounted) setInitializing(false);
      }
    };

    void restoreSession();

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  useEffect(() => {
    let mounted = true;

    const handleUrl = async (url: string | null) => {
      if (!mounted || !url) return;
      const link = classifyAppDeepLink(url);
      if (link.kind === 'payout') {
        setPasswordRecoveryActive(false);
        setPendingPayoutRoute(link.route);
        return;
      }
      if (link.kind === 'invalid-recovery') {
        setPasswordRecoveryActive(false);
        return;
      }
      if (link.kind === 'auth' && supabase) {
        setPasswordRecoveryActive(false);
        await supabase.auth.setSession({
          access_token: link.accessToken,
          refresh_token: link.refreshToken,
        });
        return;
      }
      if (link.kind !== 'recovery' || !supabase) return;

      const { error } = await supabase.auth.setSession({
        access_token: link.accessToken,
        refresh_token: link.refreshToken,
      });
      if (mounted && !error) setPasswordRecoveryActive(true);
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      setLinkingReady(false);
      void handleUrl(url).finally(() => {
        if (mounted) setLinkingReady(true);
      });
    });
    void Linking.getInitialURL()
      .then(handleUrl)
      .finally(() => {
        if (mounted) setLinkingReady(true);
      });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const exclusive = useCallback(async (action: () => Promise<AuthActionResult>) => {
    if (operationInFlight.current) return { error: 'Please wait for the current request to finish.' };
    operationInFlight.current = true;
    try {
      return await action();
    } finally {
      operationInFlight.current = false;
    }
  }, []);

  const signIn = useCallback((email: string, password: string) => exclusive(async () => {
    const { data, error } = await requireSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return { error: friendlyError(error.message) };
    if (!data.session || !data.user) {
      return { error: 'Supabase accepted the sign-in but did not return an authenticated session. Please try again.' };
    }

    // Apply the successful result immediately. onAuthStateChange remains the
    // source of truth for later refresh/sign-out events, but navigation no
    // longer depends on event timing.
    setSession(data.session);
    setInitializing(false);
    void fetchProfile(data.user.id);
    telemetry.track('login_completed');
    return { authenticated: true, success: 'Signed in.' };
  }), [exclusive, fetchProfile]);

  const signUp = useCallback((email: string, password: string, displayName: string, username: string) => exclusive(async () => {
    const client = requireSupabase();
    const normalizedUsername = username.trim().toLowerCase();
    const { data: existingProfile, error: usernameCheckError } = await client
      .from('profiles')
      .select('id')
      .eq('username', normalizedUsername)
      .maybeSingle();
    if (usernameCheckError) return { error: friendlyError(usernameCheckError.message) };
    if (existingProfile) return { error: 'That username is already taken.' };
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: 'shedmo://auth/callback',
        data: {
          display_name: displayName.trim(),
          username: normalizedUsername,
        },
      },
    });
    if (error) return { error: friendlyError(error.message) };
    return data.session
      ? { success: 'Account created.' }
      : { needsEmailVerification: true, success: 'Check your email to verify your account before signing in.' };
  }), [exclusive]);

  const forgotPassword = useCallback((email: string) => exclusive(async () => {
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'shedmo://reset-password',
    });
    return error
      ? { error: friendlyError(error.message) }
      : { success: 'If an account exists for that email, a reset link has been sent.' };
  }), [exclusive]);

  const updatePassword = useCallback((password: string) => exclusive(async () => {
    const { error } = await requireSupabase().auth.updateUser({ password });
    return error ? { error: passwordUpdateError(error) } : { success: 'Your password has been updated.' };
  }), [exclusive]);

  const signOut = useCallback(() => exclusive(async () => {
    setSigningOut(true);
    try {
      let pushToken: string | null;
      try {
        pushToken = await getStoredPushToken();
      } catch {
        return {
          error: 'Secure device storage is temporarily unavailable. Try signing out again.',
        };
      }
      if (pushToken) {
        try {
          await disablePushToken(pushToken);
        } catch {
          return {
            error: 'Push notifications could not be disconnected safely. Check your connection and try signing out again.',
          };
        }
      }
      try {
        await clearStoredPushToken();
      } catch {
        return {
          error: 'Secure device storage is temporarily unavailable. Try signing out again.',
        };
      }
      const { error } = await requireSupabase().auth.signOut();
      if (error) return { error: friendlyError(error.message) };
      setSession(null);
      setProfile(null);
      setProfileError(null);
      setPasswordRecoveryActive(false);
      setPendingPayoutRoute(null);
      return {};
    } finally {
      setSigningOut(false);
    }
  }), [exclusive]);

  const deleteAccount = useCallback(() => exclusive(async () => {
    if (!session?.user.id) return { error: 'You must be signed in to delete your account.' };
    try {
      const { data, error } = await requireSupabase().functions.invoke('delete-account', {
        body: { confirmation: 'DELETE' },
      });
      if (error) return { error: accountDeletionError(error) };
      if (data?.deleted !== true) {
        return { error: 'Account deletion could not be completed. Please try again.' };
      }
    } catch {
      return { error: 'Account deletion could not be completed. Please try again.' };
    }

    try { await clearStoredPushToken(); } catch { /* Server deletion already disabled this token. */ }
    try {
      await requireSupabase().auth.signOut({ scope: 'local' });
    } catch {
      // Server-confirmed deletion is authoritative; clear stale client state below.
    } finally {
      setSession(null);
      setProfile(null);
      setProfileError(null);
      setPasswordRecoveryActive(false);
      setPendingPayoutRoute(null);
    }
    return { success: 'Your account was deleted.' };
  }), [exclusive, session?.user.id]);

  const updateProfile = useCallback((input: ProfileUpdateInput) => exclusive(async () => {
    if (!session?.user.id) return { error: 'You must be signed in to update your profile.' };
    const { error } = await requireSupabase()
      .from('profiles')
      .update({
        display_name: input.displayName.trim(),
        username: input.username.trim().toLowerCase(),
        bio: input.bio.trim() || null,
        avatar_url: input.avatarUrl?.trim() || null,
        city: input.city.trim() || null,
        state: input.state.trim().toUpperCase() || null,
        postal_code: input.postalCode.trim().toUpperCase() || null,
      })
      .eq('id', session.user.id);
    if (error) return { error: friendlyError(error.message) };
    await fetchProfile(session.user.id);
    return { success: 'Profile updated.' };
  }), [exclusive, fetchProfile, session?.user.id]);

  const refreshProfile = useCallback(async () => {
    if (session?.user.id) await fetchProfile(session.user.id);
  }, [fetchProfile, session?.user.id]);

  const clearPasswordRecovery = useCallback(() => {
    setPasswordRecoveryActive(false);
  }, []);

  const consumePendingPayoutRoute = useCallback(() => {
    setPendingPayoutRoute(null);
  }, []);

  const value = useMemo<AuthStoreValue>(() => ({
    configurationError: supabaseConfigurationError,
    emailVerified: Boolean(session?.user.email_confirmed_at),
    initializing,
    linkingReady,
    passwordRecoveryActive,
    pendingPayoutRoute,
    profile,
    profileError,
    profileLoading,
    session,
    signingOut,
    user: session?.user ?? null,
    forgotPassword,
    clearPasswordRecovery,
    consumePendingPayoutRoute,
    deleteAccount,
    refreshProfile,
    signIn,
    signOut,
    signUp,
    updatePassword,
    updateProfile,
  }), [
    clearPasswordRecovery, consumePendingPayoutRoute, deleteAccount, forgotPassword, initializing,
    linkingReady, passwordRecoveryActive, pendingPayoutRoute, profile, profileError,
    profileLoading, refreshProfile, session, signIn, signOut, signingOut, signUp,
    updatePassword, updateProfile,
  ]);

  return <AuthStoreContext.Provider value={value}>{children}</AuthStoreContext.Provider>;
}

export function useAuthStore() {
  const value = useContext(AuthStoreContext);
  if (!value) throw new Error('useAuthStore must be used within AuthStoreProvider.');
  return value;
}

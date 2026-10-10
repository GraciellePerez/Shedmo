import 'react-native-url-polyfill/auto';

import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureSessionStorage } from '@/lib/supabase/secureStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const supabaseConfigurationError = !supabaseUrl || !supabaseAnonKey
  ? 'Supabase is not configured. Copy .env.example to .env, set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart Expo with a cleared cache.'
  : null;

export const supabase: SupabaseClient | null = supabaseConfigurationError
  ? null
  : createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        storage: secureSessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: processLock,
      },
    });

if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export function requireSupabase() {
  if (!supabase) throw new Error(supabaseConfigurationError ?? 'Supabase client is unavailable.');
  return supabase;
}

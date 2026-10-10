import { Platform } from 'react-native';

import { requireSupabase } from '@/lib/supabase/client';

export async function registerPushToken(
  token: string,
  appVersion: string | null,
) {
  const { error } = await requireSupabase().rpc('register_push_token', {
    p_expo_push_token: token,
    p_platform: Platform.OS,
    p_device_id: null,
    p_app_version: appVersion,
  });
  if (error) throw error;
}

export async function disablePushToken(token: string) {
  const { error } = await requireSupabase().rpc('unregister_push_token', {
    p_expo_push_token: token,
  });
  if (error) throw error;
}

import { requireSupabase } from '@/lib/supabase/client';

export interface BlockedUser {
  blocked_user_id: string;
  created_at: string;
  profile: { display_name: string | null; username: string | null } | null;
}

export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const result: BlockedUser[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await requireSupabase().from('user_blocks')
      .select('blocked_user_id,created_at,profile:profiles!user_blocks_blocked_user_id_fkey(display_name,username)')
      .order('blocked_user_id').range(from, from + 199);
    if (error) throw error;
    const rows = (data ?? []) as unknown as BlockedUser[];
    result.push(...rows);
    if (rows.length < 200) return result;
  }
}

// Backward-compatible discovery while the local migration awaits approval.
// Only a missing table is treated as unavailable; network/RLS errors fail closed.
export async function fetchBlockedSellerFilter(): Promise<string | null> {
  try {
    const users = await fetchBlockedUsers();
    return users.length ? `(${users.map(user => user.blocked_user_id).join(',')})` : null;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === '42P01' || code === 'PGRST205') return null;
    throw error;
  }
}

export async function setUserBlocked(userId: string, blocked: boolean) {
  const { error } = await requireSupabase().rpc('set_user_block_v1', {
    p_blocked_user_id: userId, p_blocked: blocked,
  });
  if (error) throw error;
}

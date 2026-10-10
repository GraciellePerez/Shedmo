import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import { blockingError } from './blockingErrors';
import { fetchBlockedUsers, setUserBlocked, type BlockedUser } from './blockingRepository';

interface BlockingValue {
  users: BlockedUser[];
  blockedIds: ReadonlySet<string>;
  revision: number;
  error: string | null;
  loading: boolean;
  pending: boolean;
  refresh: () => Promise<void>;
  setBlocked: (id: string, blocked: boolean) => Promise<string | null>;
}
const Context = createContext<BlockingValue | null>(null);

export function BlockingStoreProvider({ children }: PropsWithChildren) {
  const { user } = useAuthStore();
  const userId = user?.id;
  const owner = useRef(userId);
  useEffect(() => { owner.current = userId; }, [userId]);
  const [state, setState] = useState<{ owner?: string; users: BlockedUser[] }>({ users: [] });
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    if (!userId) return;
    const ticket = ++request.current;
    setLoading(true);
    try {
      const users = await fetchBlockedUsers();
      if (owner.current !== userId || ticket !== request.current) return;
      setState(previous => {
        if (previous.owner === userId && JSON.stringify(previous.users) === JSON.stringify(users)) return previous;
        return { owner: userId, users };
      });
      setError(null);
    } catch (failure) {
      if (owner.current === userId && ticket === request.current) setError(blockingError(failure));
    } finally {
      if (owner.current === userId && ticket === request.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    request.current += 1;
    setState({ users: [] });
    setError(null);
    void refresh();
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); });
    return () => subscription.remove();
  }, [refresh]);
  useEffect(() => { setRevision(value => value + 1); }, [state]);

  const setBlocked = useCallback(async (id: string, blocked: boolean) => {
    if (!userId || id === userId) return 'This user cannot be blocked.';
    if (lock.current) return 'Please wait for the current update.';
    lock.current = true;
    setPending(true);
    request.current += 1;
    try {
      await setUserBlocked(id, blocked);
      if (owner.current !== userId) return null;
      setState(previous => ({ owner: userId, users: blocked
        ? [...previous.users.filter(row => row.blocked_user_id !== id), { blocked_user_id: id, created_at: new Date().toISOString(), profile: null }]
        : previous.users.filter(row => row.blocked_user_id !== id) }));
      setError(null);
      void refresh();
      return null;
    } catch (failure) {
      return blockingError(failure);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }, [refresh, userId]);
  const users = useMemo(() => state.owner === userId ? state.users : [], [state, userId]);
  const blockedIds = useMemo(() => new Set(users.map(row => row.blocked_user_id)), [users]);
  const value = useMemo(() => ({ users, blockedIds, revision, error, loading, pending, refresh, setBlocked }),
    [users, blockedIds, revision, error, loading, pending, refresh, setBlocked]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBlockingStore() {
  const value = useContext(Context);
  if (!value) throw new Error('BlockingStoreProvider is required.');
  return value;
}

import { requireSupabase } from '@/lib/supabase/client';

export type StaffRole = 'admin' | 'moderator';
export async function adminOperation<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('admin-operations', { body: { operation, ...input } });
  if (error || data?.error) {
    let code=typeof data?.code==='string'?data.code:'';
    const context=error&&typeof error==='object'&&'context' in error?(error as {context?:unknown}).context:null;
    if(!code&&context&&typeof context==='object'&&'clone' in context&&typeof (context as {clone?:unknown}).clone==='function'){
      const response=(context as {clone:()=>{json?:()=>Promise<unknown>}}).clone();
      const body=typeof response.json==='function'?await response.json().catch(()=>null) as {code?:unknown}|null:null;
      if(typeof body?.code==='string')code=body.code;
    }
    const next=new Error(typeof data?.error === 'string' ? data.error : 'Admin operation failed.');
    if(/^[A-Z0-9_]{1,20}$/.test(code))next.name=`AdminOperation${code}Error`;
    if(__DEV__)console.info('[admin:operation:error]',{operation,errorName:next.name});
    throw next;
  }
  return data as T;
}
export async function fetchStaffRole(): Promise<StaffRole | null> {
  try { const result=await adminOperation<{role:StaffRole}>('status'); return result.role; } catch { return null; }
}

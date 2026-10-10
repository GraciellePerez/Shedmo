import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';

// Opt-in against an isolated, running Supabase stack with migration 054 and the
// revised Edge Function installed. Never use production accounts/project keys.
const url = process.env.SHEDMO_DELETION_TEST_URL;
const anonKey = process.env.SHEDMO_DELETION_TEST_ANON_KEY;
const serviceKey = process.env.SHEDMO_DELETION_TEST_SERVICE_ROLE_KEY;

test('real Auth: create, delete, recreate with the same credentials, delete again', {
  skip: !url || !anonKey || !serviceKey ? 'Isolated Supabase runtime not configured' : false,
}, async () => {
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname),
    'This destructive fixture is restricted to a local Supabase stack');
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  const admin = createClient(url, serviceKey, options);
  const email = `deletion-${randomUUID()}@example.com`;
  const password = `Deletion-${randomUUID()}!`;
  let previousId;
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = createClient(url, anonKey, options);
    const created = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { display_name: 'Deletion regression', username: `qa_${randomUUID().replaceAll('-','').slice(0,16)}` },
    });
    assert.equal(created.error,null);const uid=created.data.user.id;
    assert.notEqual(uid,previousId);previousId=uid;
    assert.equal((await client.auth.signInWithPassword({email,password})).error,null);
    const deleted=await client.functions.invoke('delete-account',{body:{confirmation:'DELETE'}});
    assert.equal(deleted.error,null);assert.equal(deleted.data?.deleted,true);
    const profile=await admin.from('profiles').select('display_name,username,bio,avatar_url').eq('id',uid).single();
    assert.equal(profile.error,null);assert.equal(profile.data.display_name,'Deleted member');
    assert.equal(profile.data.username,`deleted_${uid.replaceAll('-','').slice(0,12)}`);
    assert.equal(profile.data.bio,null);assert.equal(profile.data.avatar_url,null);
    const freshClient=createClient(url,anonKey,options);
    const login=await freshClient.auth.signInWithPassword({email,password});
    assert.ok(login.error);assert.equal(login.data.session,null);
    assert.ok((await client.auth.refreshSession()).error);
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/202608130026_grant_checkout_profile_backend_read.sql', 'utf8');

test('checkout restriction read is column-scoped and backend-only', () => {
  assert.match(sql, /grant select \(id, staff_sell_restricted, account_suspended_at\)[\s\S]*on table public\.profiles[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /to (anon|authenticated)/i);
  const grantColumns = /grant select \(([^)]+)\)/i.exec(sql)?.[1] ?? '';
  assert.doesNotMatch(grantColumns, /stripe|email|phone|display_name/i);
});

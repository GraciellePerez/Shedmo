import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations/202608130029_grant_admin_profile_backend_read.sql', import.meta.url), 'utf8');
const reviewsSql = readFileSync(new URL('../../supabase/migrations/202608130030_grant_admin_review_backend_read.sql', import.meta.url), 'utf8');

test('admin profile read grant is scoped to service role and required columns', () => {
  assert.match(sql, /grant select\s*\([\s\S]*display_name[\s\S]*username[\s\S]*account_suspended_at[\s\S]*staff_sell_restricted[\s\S]*\)\s*on table public\.profiles\s*to service_role/i);
  assert.doesNotMatch(sql, /to\s+(anon|authenticated)/i);
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete)/i);
});

test('admin rating summary grant is read-only and backend-only', () => {
  assert.match(reviewsSql, /grant select\s*\(rating, reviewee_id, direction\)\s*on table public\.marketplace_reviews\s*to service_role/i);
  assert.doesNotMatch(reviewsSql, /to\s+(anon|authenticated)/i);
  assert.doesNotMatch(reviewsSql, /grant\s+(insert|update|delete)/i);
});

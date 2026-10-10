import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/202608130024_release_expired_checkout_reservations.sql', 'utf8');
const scheduledSql = readFileSync('supabase/migrations/202608130025_schedule_expired_reservation_reclaim.sql', 'utf8');

test('expired reservations are reclaimed only before payment processing', () => {
  assert.match(sql, /payment_status in \('none','failed','canceled'\)/i);
  assert.match(sql, /reservation_expires_at <= now\(\)/i);
  assert.match(sql, /fulfillment_status in \('reserved','awaiting_payment'\)/i);
  assert.doesNotMatch(sql, /payment_status in \([^)]*'pending'|payment_status in \([^)]*'processing'/i);
});

test('reclaim cancels the stale order before reactivating its listing', () => {
  const cancel = sql.indexOf("payment_status = 'canceled'");
  const activate = sql.indexOf("status = 'active'");
  assert.ok(cancel >= 0 && activate > cancel);
  assert.match(sql, /cancellation_reason = 'reservation_expired'/i);
});

test('checkout function remains authenticated-only', () => {
  assert.match(sql, /auth\.role\(\) <> 'authenticated'/i);
  assert.match(sql, /grant execute on function public\.reserve_listing_for_checkout\(uuid,text,uuid\)\s+to authenticated/i);
});

test('backend cleanup restores expired inventory without a second checkout', () => {
  assert.match(scheduledSql, /release_expired_checkout_reservations_v1/);
  assert.match(scheduledSql, /select public\.release_expired_checkout_reservations_v1\(\);/i);
  assert.match(scheduledSql, /cron\.schedule[\s\S]*\* \* \* \* \*/i);
  assert.match(scheduledSql, /revoke all on function public\.release_expired_checkout_reservations_v1\(\)[\s\S]*from public, anon, authenticated/i);
});

test('cleanup cannot reclaim paid or in-flight payment orders', () => {
  assert.match(scheduledSql, /payment_status in \('none','failed','canceled'\)/i);
  assert.doesNotMatch(scheduledSql, /set payment_status = 'canceled'[\s\S]{0,500}payment_status in \([^)]*'pending'/i);
  assert.doesNotMatch(scheduledSql, /set payment_status = 'canceled'[\s\S]{0,500}payment_status in \([^)]*'processing'/i);
  assert.doesNotMatch(scheduledSql, /set payment_status = 'canceled'[\s\S]{0,500}payment_status in \([^)]*'succeeded'/i);
});

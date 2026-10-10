import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sender = readFileSync('supabase/functions/send-push-notification/index.ts', 'utf8');
const payloadType = readFileSync('src/features/notifications/types/pushNotification.ts', 'utf8');
const parser = readFileSync('src/features/notifications/services/pushNotificationService.ts', 'utf8');
const handler = readFileSync('src/features/notifications/hooks/usePushNotifications.tsx', 'utf8');
const localSaleSql = readFileSync('supabase/migrations/202608130031_add_hybrid_local_transactions.sql', 'utf8');

test('push sender accepts only the trusted confirmed seller local-sale event', () => {
  assert.match(sender, /notification\.type !== "local_sale_confirmation"/);
  assert.match(sender, /from\("local_sale_confirmations"\)[\s\S]*\.eq\("seller_id", notification\.user_id\)[\s\S]*\.eq\("buyer_id", notification\.actor_id\)[\s\S]*\.eq\("status", "confirmed"\)/);
  assert.match(sender, /if \(!confirmedSale\) return json\(\{ skipped: true \}\)/);
});

test('seller push uses generic copy without buyer identity', () => {
  assert.match(sender, /Someone completed a local sale for your listing\./);
  assert.match(sender, /actorId: notification\.type === "local_sale_confirmation"[\s\S]*\? null/);
});

test('client parser accepts local-sale pushes and requires listing context', () => {
  assert.match(payloadType, /'new_message' \| 'listing_favorited' \| 'local_sale_confirmation'/);
  assert.match(parser, /data\.type !== 'local_sale_confirmation'/);
  assert.match(parser, /data\.type === 'local_sale_confirmation' && !listingId/);
});

test('local-sale push opens the existing local-sale destination', () => {
  assert.match(handler, /payload\.type === 'local_sale_confirmation'[\s\S]*pathname: '\/local-sale\/\[listingId\]'/);
});

test('existing message and favorite push behavior remains intact', () => {
  assert.match(sender, /You received a new message\./);
  assert.match(sender, /Someone saved your listing\./);
  assert.match(handler, /payload\.type === 'new_message'[\s\S]*\/conversations\/\[id\]/);
  assert.match(handler, /payload\.type === 'listing_favorited'[\s\S]*\/listings\/\[id\]/);
});

test('database notification and duplicate-delivery protections remain unchanged', () => {
  assert.match(localSaleSql, /values\(v_sale\.seller_id,v_actor,'local_sale_confirmation','Local sale confirmed'/);
  assert.equal((localSaleSql.match(/values\(v_sale\.seller_id,v_actor,'local_sale_confirmation','Local sale confirmed'/g) ?? []).length, 1);
  assert.match(sender, /acquire_push_delivery_claim/);
  assert.match(sender, /duplicateOrPending: true/);
});

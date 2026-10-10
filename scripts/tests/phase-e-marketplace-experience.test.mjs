import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/202608060020_add_phase_e_marketplace_experience.sql', 'utf8');
const reconciliationMigration = readFileSync('supabase/migrations/202608060021_reconcile_phase_e_experience.sql', 'utf8');
const searchTypes = readFileSync('src/features/browse/types/search.ts', 'utf8');
const favoriteMigration = readFileSync('supabase/migrations/202607290001_create_favorites.sql', 'utf8');
const profileStore = readFileSync('src/features/profile/store/ProfileStore.tsx', 'utf8');

assert.match(migration, /fulfillment_status <> 'completed'/, 'reviews must require completed orders');
assert.match(migration, /v_actor = v_order\.buyer_id/);
assert.match(migration, /v_actor = v_order\.seller_id/);
assert.match(migration, /unique \(order_id, reviewer_id\)/, 'one review per participant');
assert.match(migration, /rating between 1 and 5/);
assert.match(migration, /reviewer_id <> reviewee_id/);
assert.match(migration, /recently_viewed_own_read[\s\S]*user_id = auth\.uid\(\)/);
assert.match(migration, /order by viewed_at desc offset 30/, 'history must be bounded');
assert.match(migration, /status = 'active'/, 'inactive listings must not be recorded');
assert.match(migration, /revoke all on table public\.marketplace_notification_events from public, anon, authenticated/);
assert.match(searchTypes, /'all' \| 'pickup' \| 'shipping'/);
assert.match(favoriteMigration, /primary key \(user_id, listing_id\)/, 'favorites remain duplicate-safe');
assert.match(favoriteMigration, /user_id = auth\.uid\(\)/, 'favorites remain owner scoped');
assert.match(reconciliationMigration, /get_order_review_status/);
assert.match(reconciliationMigration, /exists\(select 1 from public\.marketplace_reviews/);
assert.match(reconciliationMigration, /unique index marketplace_notification_events_event_key_uidx/);
assert.match(reconciliationMigration, /on conflict \(event_key\) do nothing/g);
assert.match(reconciliationMigration, /exception when others then[\s\S]*null/, 'notification failure must not block authoritative state');
assert.match(reconciliationMigration, /old\.payment_status is distinct from 'succeeded'/);
assert.match(reconciliationMigration, /old\.fulfillment_status is distinct from 'completed'/);
assert.match(reconciliationMigration, /old\.transfer_status is distinct from 'transferred'/);
assert.doesNotMatch(reconciliationMigration, /stripe|payment_intent|transfer_id/i, 'notification payloads must not contain Stripe identifiers');
assert.doesNotMatch(profileStore, /4\.9|127|itemsSold:\s*89/, 'personal profile must not contain fabricated statistics');

console.log('Phase E review state, real profile stats, idempotent notifications, recently-viewed, search, and favorite guards passed.');

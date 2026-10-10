import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { blockingError, isBlockedInteraction } from '../../src/features/blocking/blockingErrors.ts';

const db = new PGlite();
const read = path => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/202609130043_add_user_blocking.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = async n => {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id(n)]);
};
const block = (n, value = true) => db.query('select public.set_user_block_v1($1,$2)', [id(n), value]);
const send = (n, conversation = 101) => db.query('insert into public.messages(conversation_id,sender_id,body) values($1,$2,$3)', [id(conversation), id(n), 'Hello']);
const rows = async sql => (await db.query(sql)).rows;

before(async () => {
  // Ephemeral local PostgreSQL only; never connects to Supabase.
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, display_name text, username text);
    create table public.listings (
      id uuid primary key, seller_id uuid references public.profiles(id),
      title text, description text, category text, brand text, condition text, status text,
      price numeric, created_at timestamptz default now(), latitude double precision,
      longitude double precision, pickup_available boolean, shipping_available boolean
    );
    alter table public.listings enable row level security;
    create policy listing_read on public.listings for select to authenticated using (true);
    grant select on public.profiles, public.listings to authenticated;
  `);
  const messaging = read('supabase/migrations/202607290002_create_messaging.sql');
  await db.exec(messaging.slice(0, messaging.indexOf('-- Existing conversation participants')));
  await db.exec('grant select, insert on public.conversations, public.messages to authenticated; grant select, insert, update on public.conversation_reads to authenticated;');
  await db.exec(read('supabase/migrations/202607300011_add_content_reports.sql'));
  await db.exec(read('supabase/migrations/202609090042_improve_marketplace_search.sql'));
  await db.exec(migration);
});
after(() => db.close());
beforeEach(async () => {
  await db.exec('reset role; truncate public.profiles cascade;');
  for (const n of [1, 2, 3]) await db.query('insert into profiles values($1,$2,$3)', [id(n), `User ${n}`, `user${n}`]);
  for (let n = 1; n <= 45; n++) await db.query(`insert into listings
    (id,seller_id,title,description,category,condition,status,price,created_at,latitude,longitude,pickup_available,shipping_available)
    values ($1,$2,'Cordless drill','Working tool','tools','good','active',$3,$4,41,-87,true,false)`,
  [id(n), id(n % 2 ? 2 : 3), n, `2026-01-${String(1 + n % 20).padStart(2, '0')}T00:00:00Z`]);
  await db.query('insert into conversations(id,listing_id,buyer_id,seller_id) values($1,$2,$3,$4)', [id(101), id(1), id(1), id(2)]);
  await actor(2); await send(2);
  await actor(1);
});

test('block/unblock are idempotent and preserve messages, listings, and conversations', async () => {
  await block(2); await block(2);
  assert.equal((await rows('select * from user_blocks')).length, 1);
  assert.equal((await rows('select * from messages')).length, 1);
  assert.equal((await rows('select * from conversations')).length, 1);
  assert.equal((await rows('select * from listings')).length, 45);
  await block(2, false); await block(2, false);
  assert.equal((await rows('select * from user_blocks')).length, 0);
  await send(1);
});

test('self, missing, malformed, and null targets cannot create relationships', async () => {
  await assert.rejects(block(1), /Invalid user/);
  await assert.rejects(block(99), /User unavailable/);
  await assert.rejects(db.query("select set_user_block_v1('bad-id',true)"), /uuid/);
  await assert.rejects(db.query('select set_user_block_v1(null,true)'), /Invalid user/);
  await assert.rejects(db.query('select set_user_block_v1($1,null)', [id(2)]), /Invalid user/);
  assert.equal((await rows('select * from user_blocks')).length, 0);
});

test('RLS prevents enumeration, forged relationships, other-user deletion and updates', async () => {
  await block(2);
  await actor(2);
  assert.deepEqual(await rows('select * from user_blocks'), []);
  assert.equal((await rows(`select has_blocked_user_v1('${id(1)}') as blocked`))[0].blocked, false);
  await db.query('delete from user_blocks where blocker_user_id=$1', [id(1)]);
  await assert.rejects(db.query('insert into user_blocks(blocker_user_id,blocked_user_id) values($1,$2)', [id(1),id(3)]), /row-level security/);
  await assert.rejects(db.exec('update user_blocks set created_at=now()'), /permission denied/);
  await assert.rejects(db.query('select lock_block_pair_v1($1,$2)', [id(1),id(2)]), /permission denied/);
  await actor(3);
  await assert.rejects(db.query('insert into conversations(listing_id,buyer_id,seller_id) values($1,$2,$3)', [id(3),id(1),id(2)]), /Communication unavailable/);
  await assert.rejects(send(1), /Communication unavailable/);
  await actor(1);
  assert.equal((await rows('select * from user_blocks')).length, 1);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.exec('select * from user_blocks'), /permission denied/);
  await assert.rejects(block(2), /permission denied/);
});

test('direct table writes retain unique, self-block and foreign-key protection', async () => {
  await db.query('insert into user_blocks(blocker_user_id,blocked_user_id) values($1,$2)', [id(1),id(2)]);
  await assert.rejects(db.query('insert into user_blocks(blocker_user_id,blocked_user_id) values($1,$2)', [id(1),id(2)]), /unique/);
  await assert.rejects(db.query('insert into user_blocks(blocker_user_id,blocked_user_id) values($1,$2)', [id(1),id(1)]), /check constraint/);
  await assert.rejects(db.query('insert into user_blocks(blocker_user_id,blocked_user_id) values($1,$2)', [id(1),id(99)]), /foreign key/);
});

test('database rejects messages and new conversations in both directions after blocking', async () => {
  await block(2);
  await assert.rejects(send(1), /SHEDMO_INTERACTION_UNAVAILABLE/);
  await assert.rejects(db.query('insert into conversations(listing_id,buyer_id,seller_id) values($1,$2,$3)', [id(3),id(1),id(2)]), /SHEDMO_INTERACTION_UNAVAILABLE/);
  await actor(2);
  await assert.rejects(send(2), /SHEDMO_INTERACTION_UNAVAILABLE/);
  assert.equal((await rows('select * from messages')).length, 1, 'history remains readable');
  await block(1);
  await actor(1); await block(2, false);
  await assert.rejects(send(1), /SHEDMO_INTERACTION_UNAVAILABLE/, 'other direction still blocked');
  await actor(2); await block(1, false); await send(2);
});

test('unrelated participants can create conversations and message normally', async () => {
  await block(2);
  await actor(3);
  await db.query('insert into conversations(id,listing_id,buyer_id,seller_id) values($1,$2,$3,$4)', [id(102),id(1),id(3),id(2)]);
  await send(3,102);
  await actor(2); await send(2,102);
  await actor(1);
  assert.equal((await rows(`select * from messages where conversation_id='${id(102)}'`)).length, 0);
});

test('blocked seller is excluded before discovery, search and nearby pagination only for blocker', async () => {
  await block(2);
  const visible = await rows('select id from listings where not has_blocked_user_v1(seller_id) order by price limit 12');
  assert.deepEqual(visible.map(row => row.id), Array.from({ length: 12 }, (_, i) => id((i+1)*2)));
  for (const query of ['', 'drill', 'dirll', 'cordless dri']) {
    const seen = [];
    let cursor = null;
    do {
      const page = (await db.query(`select * from search_marketplace_listings_v3(p_query=>$1,p_sort=>'price_asc',p_limit=>7,
        p_cursor_id=>$2,p_cursor_created_at=>$3,p_cursor_price=>$4)`, [query,cursor?.listing_id ?? null,cursor?.cursor_created_at ?? null,cursor?.cursor_price ?? null])).rows;
      seen.push(...page.map(row => row.listing_id));
      cursor = page.length === 7 ? page.at(-1) : null;
    } while (cursor);
    assert.deepEqual(seen, Array.from({ length: 22 }, (_,i) => id((i+1)*2)), query);
  }
  const nearby = await rows('select * from nearby_listings(41,-87,null,50,0)');
  assert.equal(nearby.length,22);
  await actor(3);
  assert.equal((await rows("select * from search_marketplace_listings_v3(p_query=>'drill',p_limit=>50)")).length,45);
  await actor(1); await block(2,false);
  assert.equal((await rows("select * from search_marketplace_listings_v3(p_query=>'drill',p_limit=>50)")).length,45);
});

test('reporting blocked sellers and historical messages still works without exposing reports', async () => {
  await block(2);
  const report = async (type,target,reason,conversation=null) => (await db.query('select submit_content_report($1,$2,$3,null,$4) as result', [type,target,reason,conversation])).rows[0].result;
  assert.equal(await report('seller',id(2),'harassment'),'submitted');
  assert.equal(await report('seller',id(2),'harassment'),'duplicate');
  const message = (await rows('select id from messages'))[0];
  assert.equal(await report('message',message.id,'harassment',id(101)),'submitted');
  assert.equal(await report('listing',id(1),'prohibited_item'),'submitted');
  await assert.rejects(db.exec('select * from reports'), /permission denied/);
});

test('profile deletion cascades block relationships without modifying account deletion code', async () => {
  await block(2);
  await db.exec('reset role');
  await db.query('delete from profiles where id=$1',[id(1)]);
  assert.deepEqual(await rows('select * from user_blocks'),[]);
  const deletion = read('supabase/functions/delete-account/index.ts');
  assert.match(deletion, /admin\.auth\.admin\.deleteUser\(user.id, true\)/);
});

test('blocking errors are actionable and do not disclose who blocked whom', () => {
  assert.equal(isBlockedInteraction({ message: 'SHEDMO_INTERACTION_UNAVAILABLE' }), true);
  assert.equal(isBlockedInteraction({ message: 'network error' }), false);
  assert.match(blockingError({ code: 'PGRST202' }), /not available yet/);
  assert.match(blockingError({ code: '22023' }), /cannot be blocked/);
});

test('discovery filters precede server pagination and historical messaging joins stay intact', () => {
  const listings = read('src/features/listings/services/listingRepository.ts');
  for (const name of ['fetchActiveListings','fetchRecentlyViewedListings','fetchPublicSellerListings','fetchListingById']) {
    const body = listings.split(`export async function ${name}(`)[1].split('\nexport ')[0];
    assert.match(body, /query\.not\('seller_id', 'in', blocked\)/);
  }
  const favorites = read('src/features/favorites/services/favoritesRepository.ts');
  assert.match(favorites, /!favorites_listing_id_fkey!inner/);
  assert.match(favorites, /query\.not\('listing.seller_id', 'in', blocked\)/);
  assert.doesNotMatch(read('src/features/messaging/services/messagingRepository.ts'), /user_blocks|blockedSeller/);
  assert.match(read('src/features/account/SettingsScreen.tsx'), /slug: 'blocked-users'/);
  assert.match(read('src/features/account/SettingDetailScreen.tsx'), /slug === 'blocked-users'/);
});

test('search and nearby SQL differ only by the blocking predicate', () => {
  for (const [file, name] of [
    ['202609090042_improve_marketplace_search.sql','search_marketplace_listings_v3'],
    ['202607290005_add_marketplace_location.sql','nearby_listings'],
  ]) {
    const extract = source => {
      const start = source.indexOf(`create or replace function public.${name}(`);
      return source.slice(start, source.indexOf('$$;', start) + 3).replace(/\r\n/g, '\n');
    };
    assert.equal(extract(migration).replace(/\n +and not public\.has_blocked_user_v1\(l\.seller_id\)/g, ''),
      extract(read(`supabase/migrations/${file}`)));
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const read = name => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const privateFields = ['postal_code', 'updated_at', 'account_suspended_at', 'account_suspended_by', 'staff_sell_restricted'];
const publicFields = ['id', 'display_name', 'username', 'bio', 'avatar_url', 'city', 'state', 'created_at'];
const actor = async (n, role = n ? 'authenticated' : 'anon') => {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false)", [n ? id(n) : '', role]);
};
const denied = action => assert.rejects(action, e => e.code === '42501');

before(async () => {
  // Entirely local, in-memory database. No real accounts or API connections.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  await db.exec(read('202607280001_create_profiles'));
  const location = read('202607290005_add_marketplace_location');
  await db.exec(location.slice(0, location.indexOf('alter table public.listings')));
  await db.exec(`create table listings(id uuid primary key default gen_random_uuid(),seller_id uuid references profiles(id),status text);
    alter table listings enable row level security;
    create policy listing_read on listings for select using(status='active' or seller_id=auth.uid());
    create policy listing_write on listings for insert to authenticated with check(seller_id=auth.uid());
    grant select on listings to anon,authenticated; grant insert on listings to authenticated;`);
  const moderation = read('202608060022_add_phase_f_minimal_admin');
  await db.exec(moderation.slice(0, moderation.indexOf('create or replace function public.is_listing_checkout_eligible')));
  await db.exec(read('202608130026_grant_checkout_profile_backend_read'));
  await db.exec(read('202608130029_grant_admin_profile_backend_read'));
  await db.exec(read('202607290012_add_public_seller_bio'));
  await db.exec(`create table orders(seller_id uuid,fulfillment_status text,completed_at timestamptz);
    create table local_sale_confirmations(seller_id uuid,status text);
    create table marketplace_reviews(reviewee_id uuid,direction text,rating smallint);`);
  const sellerV2 = read('202609070040_separate_listing_status_from_local_sale_confirmation')
    .match(/create or replace function public\.get_public_seller_profile_v2[\s\S]*?\$\$;/);
  assert.ok(sellerV2);
  await db.exec(sellerV2[0]);
  await db.exec('revoke all on function get_public_seller_profile_v2(uuid) from public; grant execute on function get_public_seller_profile_v2(uuid) to authenticated;');
  await db.exec(read('202609140045_restrict_profile_private_fields'));
});
after(() => db.close());
beforeEach(async () => {
  await actor(null, 'service_role');
  await db.exec('reset role; truncate auth.users cascade;');
  for (const n of [1, 2]) {
    await db.query('insert into auth.users values($1,$2)', [id(n), { display_name: `Seller ${n}`, username: `seller_${n}` }]);
    await db.query('update profiles set postal_code=$1,city=$2,state=$3 where id=$4', ['12345', 'Test City', 'IL', id(n)]);
  }
  await db.query("insert into listings(seller_id,status) values($1,'active')", [id(2)]);
});

for (const field of privateFields) {
  test(`anonymous and other authenticated users cannot SELECT or filter by private ${field}`, async () => {
    for (const n of [null, 1]) {
      await actor(n);
      await denied(() => db.query(`select ${field} from profiles where id=$1`, [id(2)]));
      await denied(() => db.query(`select id from profiles where ${field} is not null`));
      await denied(() => db.query(`select id from profiles order by ${field}`));
    }
  });
}

test('public identity fields and listing seller joins remain accessible', async () => {
  for (const n of [null, 1]) {
    await actor(n);
    assert.equal((await db.query(`select ${publicFields.join(',')} from profiles`)).rows.length, 2);
    assert.equal((await db.query(`select ${publicFields.map(f => `p.${f}`).join(',')} from listings l join profiles p on p.id=l.seller_id`)).rows.length, 1);
    await denied(() => db.query('select * from profiles'));
  }
});

test('owner RPC returns only the caller profile, including private postal code', async () => {
  await actor(1);
  const rows = (await db.query('select * from get_my_profile_v1()')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id(1));
  assert.equal(rows[0].postal_code, '12345');
  for (const field of privateFields.filter(f => !['postal_code', 'updated_at'].includes(f))) assert.ok(!(field in rows[0]));
  assert.equal((await db.query('select * from get_my_profile_v1() where id=$1', [id(2)])).rows.length, 0);
  await actor(null);
  await denied(() => db.query('select * from get_my_profile_v1()'));
});

test('owner can update permitted fields without exposing private RETURNING columns', async () => {
  await actor(1);
  await db.query(`update profiles set postal_code='54321',display_name='Updated Seller',username='updated_seller',
    bio='Updated bio',avatar_url='https://example.invalid/avatar.jpg',city='Other City',state='CA' where id=$1`, [id(1)]);
  const own = (await db.query('select * from get_my_profile_v1()')).rows[0];
  assert.equal(own.postal_code, '54321');
  assert.equal(own.display_name, 'Updated Seller');
  assert.equal(own.avatar_url, 'https://example.invalid/avatar.jpg');
  assert.equal((await db.query("update profiles set display_name='Forged' where id=$1 returning id", [id(2)])).rows.length, 0);
  await denied(() => db.query('update profiles set staff_sell_restricted=true where id=$1', [id(1)]));
});

test('trusted backend keeps its moderation read grants; ordinary users cannot read staff roles', async () => {
  await actor(1, 'service_role');
  assert.equal((await db.query('select id,account_suspended_at,staff_sell_restricted from profiles')).rows.length, 2);
  await actor(1);
  await denied(() => db.query('select * from staff_roles'));
});

test('listing moderation trigger still permits normal sellers and denies restricted sellers', async () => {
  await actor(1);
  await db.query("insert into listings(seller_id,status) values($1,'active')", [id(1)]);
  await actor(null, 'service_role'); await db.exec('reset role');
  await db.query('update profiles set staff_sell_restricted=true where id=$1', [id(1)]);
  await actor(1);
  await denied(() => db.query("insert into listings(seller_id,status) values($1,'active')", [id(1)]));
  await denied(() => db.query('select enforce_listing_moderation()'));
});

test('existing public seller RPC returns identity and counts without private fields', async () => {
  await actor(1);
  for (const name of ['get_public_seller_profile', 'get_public_seller_profile_v2']) {
    const seller = (await db.query(`select * from ${name}($1)`, [id(2)])).rows[0];
    assert.equal(seller.display_name, 'Seller 2');
    assert.equal(Number(seller.active_listing_count), 1);
    for (const field of privateFields) assert.ok(!(field in seller));
    if (name.endsWith('_v2')) {
      for (const field of ['verified_sales_count', 'average_rating', 'total_reviews']) assert.ok(field in seller);
    }
  }
});

test('marketplace profile embeddings use only granted public columns and owner queries avoid select star', () => {
  for (const file of ['listings/services/listingRepository', 'favorites/services/favoritesRepository', 'messaging/services/messagingRepository', 'blocking/blockingRepository', 'localSales/localSaleRepository']) {
    const source = readFileSync(`src/features/${file}.ts`, 'utf8');
    for (const match of source.matchAll(/profiles![\w]+\s*\(([^)]+)\)/g)) {
      for (const field of match[1].split(',').map(s => s.trim())) assert.ok(publicFields.includes(field), `${file}: ${field}`);
    }
  }
  const auth = readFileSync('src/features/auth/store/AuthStore.tsx', 'utf8');
  assert.match(auth, /rpc\('get_my_profile_v1'\)/);
  assert.doesNotMatch(auth, /\.select\('\*'\)/);
  assert.match(auth, /postal_code: input.postalCode/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// In-memory database only. Synthetic paths; no remote clients or credentials.
const db = new PGlite();
const read = name => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const path = (seller, listing, file = 'photo.jpg') => `${id(seller)}/${id(listing)}/${file}`;
const actor = async n => {
  await db.exec(`reset role; set role ${n ? 'authenticated' : 'anon'}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [n ? id(n) : '']);
};
const upload = (seller, listing, file) => db.query(
  'insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',
  ['listing-images', path(seller, listing, file), id(seller)],
);
const attach = (listing, objectPath, sort = 0) => db.query(
  'insert into public.listing_images(listing_id,storage_path,sort_order) values($1,$2,$3)',
  [id(listing), objectPath, sort],
);
const visible = async objectPath => Number((await db.query(
  'select count(*) as count from storage.objects where name=$1', [objectPath],
)).rows[0].count);
const denied = action => assert.rejects(action, error => error.code === '42501');

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create schema storage;
    create publication supabase_realtime;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create function storage.foldername(text) returns text[] language sql immutable as $$
      select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    create function storage.filename(text) returns text language sql immutable as $$
      select split_part($1,'/',array_length(string_to_array($1,'/'),1)) $$;
    create table public.profiles(id uuid primary key);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema auth,storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant select on storage.objects to anon;
    grant select on public.profiles to anon,authenticated;
  `);
  // PGlite has gen_random_uuid built in; pgcrypto extension installation is not needed.
  await db.exec(read('202607280002_create_listings_and_storage').replace('create extension if not exists pgcrypto;', ''));
  await db.exec(read('202607290001_create_favorites'));
  await db.exec(read('202607290002_create_messaging'));
  // Minimal financial fixture; the actual history/evidence policies below are unmodified.
  await db.exec(`create table public.orders(id uuid primary key,listing_id uuid,buyer_id uuid,seller_id uuid);
    alter table public.orders enable row level security;
    create policy participants on public.orders for select to authenticated using(auth.uid() in (buyer_id,seller_id));
    grant select on public.orders to authenticated;`);
  await db.exec(read('202608150033_allow_order_participants_read_listing_history'));
  await db.exec(read('202609080041_add_profile_avatar_storage'));
  const financial = read('202608060018_add_phase_d3_financial_safety');
  for (const name of ['Buyer uploads own dispute evidence', 'Order participants read dispute evidence']) {
    const policy = financial.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
    assert.ok(policy);
    await db.exec(policy[0]);
  }
  await db.exec(read('202609140044_harden_listing_image_authorization'));
});
after(() => db.close());

beforeEach(async () => {
  await db.exec('reset role; truncate public.profiles cascade; truncate storage.objects,public.orders;');
  for (const n of [1, 2, 3]) await db.query('insert into profiles values($1)', [id(n)]);
  for (const [listing, seller] of [[11, 1], [12, 1], [21, 2]]) {
    await db.query(`insert into listings(id,seller_id,title,description,price,category,condition,status)
      values($1,$2,'Test tool','Synthetic test description',10,'tools','good','active')`, [id(listing), id(seller)]);
  }
  await actor(1); await upload(1, 11); await upload(1, 12);
  await actor(2); await upload(2, 21); await attach(21, path(2, 21));
  await db.query("update listings set status='archived' where id=$1", [id(21)]);
  await actor(1);
});

test('owner can upload, read before attachment, attach and reorder their listing image', async () => {
  assert.equal(await visible(path(1, 11)), 1);
  await attach(11, path(1, 11));
  assert.equal((await db.query('update listing_images set sort_order=1 returning id')).rows.length, 1);
});

test('cross-owner metadata INSERT is denied and does not expose the private image', async () => {
  assert.equal(await visible(path(2, 21)), 0);
  await denied(() => attach(11, path(2, 21)));
  assert.equal(await visible(path(2, 21)), 0);
});

test('cross-owner metadata UPDATE is denied while the original association survives', async () => {
  await attach(11, path(1, 11));
  await denied(() => db.query('update listing_images set storage_path=$1 where listing_id=$2', [path(2, 21), id(11)]));
  assert.equal((await db.query('select count(*) as count from listing_images where listing_id=$1 and storage_path=$2', [id(11), path(1, 11)])).rows[0].count, 1);
});

test('legitimate replacement works but moving metadata to another listing folder is denied', async () => {
  await attach(11, path(1, 11));
  await upload(1, 11, 'replacement.jpg');
  await db.query('update listing_images set storage_path=$1 where listing_id=$2', [path(1, 11, 'replacement.jpg'), id(11)]);
  await denied(() => db.query('update listing_images set listing_id=$1 where listing_id=$2', [id(12), id(11)]));
  await denied(() => db.query('update listing_images set listing_id=$1 where listing_id=$2', [id(21), id(11)]));
});

test('helper cannot approve another seller object and its RPC is unavailable anonymously', async () => {
  assert.equal((await db.query('select public.can_attach_listing_image_v1($1,$2) as allowed', [id(21), path(2, 21)])).rows[0].allowed, false);
  await actor(0);
  await denied(() => db.query('select public.can_attach_listing_image_v1($1,$2)', [id(11), path(1, 11)]));
  await db.exec('reset role');
  const policies = (await db.query("select permissive from pg_policies where policyname in ('listing_images_authorized_object_insert','listing_images_authorized_object_update','listing_photos_require_authorized_relationship')")).rows;
  assert.equal(policies.length, 3);
  assert.ok(policies.every(row => row.permissive === 'RESTRICTIVE'));
});

test('missing objects, wrong listing folders, malformed paths and wrong actual owners are denied', async () => {
  for (const objectPath of [path(1, 11, 'missing.jpg'), path(1, 12), path(1, 11, '../photo.jpg'), path(1, 11, '..')]) {
    await denied(() => attach(11, objectPath));
  }
  await db.exec('reset role');
  await db.query('update storage.objects set owner_id=$1 where name=$2', [id(2), path(1, 11)]);
  await actor(1);
  await denied(() => attach(11, path(1, 11)));
  assert.equal(await visible(path(1, 11)), 0);
});

test('pre-existing forged metadata cannot open private photos, even through order history', async () => {
  await db.exec('reset role');
  await attach(11, path(2, 21)); // Represents pre-migration corruption, inserted as DB owner.
  await db.query('insert into orders values($1,$2,$3,$4)', [id(91), id(11), id(3), id(1)]);
  for (const user of [1, 3]) {
    await actor(user);
    assert.equal(await visible(path(2, 21)), 0);
  }
});

test('legitimate active images remain readable to authenticated marketplace visitors', async () => {
  await attach(11, path(1, 11));
  for (const user of [2, 3]) {
    await actor(user);
    assert.equal(await visible(path(1, 11)), 1);
  }
});

test('owner cleanup remains possible without deleting another seller metadata or object', async () => {
  await attach(11, path(1, 11));
  assert.equal((await db.query('delete from listing_images where listing_id=$1 returning id', [id(21)])).rows.length, 0);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [path(2, 21)])).rows.length, 0);
  assert.equal((await db.query('delete from listing_images where listing_id=$1 returning id', [id(11)])).rows.length, 1);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [path(1, 11)])).rows.length, 1);
});

test('profile avatar ownership policies and public bucket configuration remain unchanged', async () => {
  const avatarPath = `${id(1)}/avatar.jpg`;
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('profile-avatars',$1,$2)", [avatarPath, id(1)]);
  assert.equal(await visible(avatarPath), 1);
  await db.query("update storage.objects set name=name where bucket_id='profile-avatars'");
  await actor(2);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [avatarPath])).rows.length, 0);
  await db.exec('reset role');
  assert.equal((await db.query("select public from storage.buckets where id='profile-avatars'")).rows[0].public, true);
});

test('conversation participants retain historical listing photos and text messaging', async () => {
  await attach(11, path(1, 11));
  await actor(3);
  await db.query('insert into conversations(id,listing_id,buyer_id,seller_id) values($1,$2,$3,$4)', [id(81), id(11), id(3), id(1)]);
  await actor(1); await db.query("update listings set status='archived' where id=$1", [id(11)]);
  await actor(3);
  assert.equal(await visible(path(1, 11)), 1);
  await db.query('insert into messages(conversation_id,sender_id,body) values($1,$2,$3)', [id(81), id(3), 'Synthetic message']);
  await actor(2);
  assert.equal(await visible(path(1, 11)), 0);
});

test('order participants retain historical photos and private dispute evidence stays restricted', async () => {
  await attach(11, path(1, 11));
  await db.exec('reset role');
  await db.query('insert into orders values($1,$2,$3,$4)', [id(91), id(11), id(3), id(1)]);
  await db.query("update listings set status='archived' where id=$1", [id(11)]);
  await actor(3);
  const evidence = path(3, 91);
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('dispute-evidence',$1,$2)", [evidence, id(3)]);
  assert.equal(await visible(path(1, 11)), 1);
  assert.equal(await visible(evidence), 1);
  await actor(1); assert.equal(await visible(evidence), 1);
  await actor(2); assert.equal(await visible(evidence), 0);
  await actor(0); await denied(() => visible(evidence));
});

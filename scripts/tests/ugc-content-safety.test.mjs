import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { CONTENT_SAFETY_MESSAGE, isContentSafetyError } from '../../src/features/safety/contentSafety.ts';
import { friendlyError } from '../../src/features/auth/authErrors.ts';

const db = new PGlite();
const read = path => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/202609130043_add_user_blocking.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = async n => {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false),set_config('request.jwt.claim.role','authenticated',false)", [id(n)]);
};
const block = (n, value = true) => db.query('select public.set_user_block_v1($1,$2)', [id(n), value]);
const send = (n, conversation = 101) => db.query('insert into public.messages(conversation_id,sender_id,body) values($1,$2,$3)', [id(conversation), id(n), 'Hello']);
const rows = async sql => (await db.query(sql)).rows;

before(async () => {
  // Ephemeral local PostgreSQL only; never connects to Supabase.
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    grant usage on schema auth to authenticated, anon;
    create table public.profiles(id uuid primary key, display_name text, username text, bio text, avatar_url text, city text, state text, postal_code text, created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.listings (
      id uuid primary key default gen_random_uuid(), seller_id uuid references public.profiles(id),
      title text, description text, category text, brand text, condition text, status text,
      price numeric, created_at timestamptz default now(), latitude double precision,
      longitude double precision, pickup_available boolean, shipping_available boolean
    );
    alter table public.listings enable row level security;
    create policy listing_read on public.listings for select to authenticated using (true);
    grant select,update on public.profiles to authenticated;
    grant select,insert,update on public.listings to authenticated;
    alter table profiles enable row level security;
    create policy profile_read on profiles for select to authenticated using(true);
    create policy profile_write on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
    create policy listing_insert on listings for insert to authenticated with check(seller_id=auth.uid());
    create policy listing_update on listings for update to authenticated using(seller_id=auth.uid()) with check(seller_id=auth.uid());
    create table orders(id uuid primary key,buyer_id uuid,seller_id uuid,fulfillment_status text,completed_at timestamptz);
  `);
  const messaging = read('supabase/migrations/202607290002_create_messaging.sql');
  await db.exec(messaging.slice(0, messaging.indexOf('-- Existing conversation participants')));
  await db.exec('grant select, insert on public.conversations, public.messages to authenticated; grant select, insert, update on public.conversation_reads to authenticated;');
  await db.exec(read('supabase/migrations/202607300011_add_content_reports.sql'));
  await db.exec(read('supabase/migrations/202609090042_improve_marketplace_search.sql'));
  await db.exec(migration);
  const reviews = read('supabase/migrations/202608060020_add_phase_e_marketplace_experience.sql');
  await db.exec(reviews.slice(0,reviews.indexOf('create function public.get_profile_reviews')));
  const local = read('supabase/migrations/202608130031_add_hybrid_local_transactions.sql');
  await db.exec(local.slice(local.indexOf('create table public.local_sale_confirmations'),local.indexOf('alter table public.notifications')));
  await db.exec(local.slice(local.indexOf('alter table public.marketplace_reviews'),local.indexOf('alter table public.marketplace_analytics_events')));
  await db.exec('revoke all on function submit_local_sale_review_v1(uuid,smallint,text) from public; grant execute on function submit_local_sale_review_v1(uuid,smallint,text) to authenticated;');
  const moderation = read('supabase/migrations/202608060022_add_phase_f_minimal_admin.sql');
  await db.exec(moderation.slice(0,moderation.indexOf('create or replace function public.is_listing_checkout_eligible')));
  await db.exec(moderation.slice(moderation.indexOf('create function public.phase_f_staff_role'),moderation.indexOf('create function public.staff_resolve_dispute_v1')));
  await db.exec('revoke all on function staff_moderate_listing_v1(uuid,uuid,text,text),phase_f_staff_role(uuid,boolean) from public,anon,authenticated; grant execute on function staff_moderate_listing_v1(uuid,uuid,text,text),phase_f_staff_role(uuid,boolean) to service_role;');
  await db.exec(read('supabase/migrations/202609140045_restrict_profile_private_fields.sql'));
  const profiles = read('supabase/migrations/202607280001_create_profiles.sql');
  await db.exec(profiles.slice(profiles.indexOf('create or replace function public.handle_new_auth_user'),profiles.indexOf('alter table public.profiles enable')));
  await db.exec(read('supabase/migrations/202609140046_add_ugc_text_safety.sql'));
});
after(() => db.close());
beforeEach(async () => {
  await db.exec('reset role; truncate public.profiles, public.orders, auth.users cascade;');
  for (const n of [1, 2, 3]) await db.query('insert into profiles(id,display_name,username) values($1,$2,$3)', [id(n), `User ${n}`, `user${n}`]);
  for (let n = 1; n <= 2; n++) await db.query(`insert into listings
    (id,seller_id,title,description,category,condition,status,price,created_at,latitude,longitude,pickup_available,shipping_available)
    values ($1,$2,'Cordless drill','Working tool','tools','good','active',$3,$4,41,-87,true,false)`,
  [id(n), id(n % 2 ? 2 : 3), n, `2026-01-${String(1 + n % 20).padStart(2, '0')}T00:00:00Z`]);
  await db.query('insert into conversations(id,listing_id,buyer_id,seller_id) values($1,$2,$3,$4)', [id(101), id(1), id(1), id(2)]);
  await db.query("insert into orders values($1,$2,$3,'completed',now())",[id(201),id(1),id(2)]);
  await db.query("insert into local_sale_confirmations(id,listing_id,conversation_id,seller_id,buyer_id,status,listing_title_snapshot,listing_price_snapshot,seller_confirmed_at,buyer_confirmed_at) values($1,$2,$3,$4,$5,'confirmed','Drill',20,now(),now())",[id(301),id(1),id(101),id(2),id(1)]);
  await actor(2); await send(2);
  await actor(1);
});


const forbidden = 'I will kill you';
const rejected = action => assert.rejects(action, e => e.code === 'P0001' && e.message === 'SHEDMO_CONTENT_NOT_ALLOWED');
const review = body => db.query('select submit_marketplace_review($1,5::smallint,$2)', [id(201),body]);
const localReview = body => db.query('select submit_local_sale_review_v1($1,5::smallint,$2)', [id(301),body]);
const message = body => db.query('insert into messages(conversation_id,sender_id,body) values($1,$2,$3)', [id(101),id(1),body]);

test('normal marketplace language and optional empty text remain allowed', async () => {
  for (const text of [null,'','Nail gun, heat gun and caulk gun','Weed killer sprayer','Kill switch works','Drug-free household',
    'Replica vintage tool chest','My tools were stolen; looking for replacements','Excellent transaction','I will call you tomorrow']) {
    assert.equal((await db.query('select ugc_text_is_prohibited_v1($1) as blocked',[text])).rows[0].blocked,false,text);
  }
});
test('narrow prohibited phrases normalize case, punctuation, Unicode width and invisible separators', async () => {
  for (const text of [forbidden,'I WILL...KILL YOU!','Ｉ will kill you','I will ki\u200bll you',"I'm going to murder you",
    'Selling stolen tools','Cocaine for sale','Go kill yourself','-----BEGIN RSA PRIVATE KEY-----']) {
    assert.equal((await db.query('select ugc_text_is_prohibited_v1($1) as blocked',[text])).rows[0].blocked,true);
  }
});
test('direct listing creation and updates enforce all text fields atomically', async () => {
  const create = text => db.query("insert into listings(seller_id,title,status) values($1,$2,'active') returning id",[id(1),text]);
  const created = (await create('Used nail gun')).rows[0].id;
  await rejected(()=>create('Selling stolen tools'));
  for (const field of ['title','description','brand','category']) {
    await rejected(()=>db.query(`update listings set ${field}=$1 where id=$2`,[forbidden,created]));
  }
  assert.equal((await db.query('select title from listings where id=$1',[created])).rows[0].title,'Used nail gun');
  assert.equal((await rows('select id from listings')).length,3);
});
test('API clients cannot disable triggers or replace the rules', async () => {
  await assert.rejects(db.exec('alter table listings disable trigger listings_ugc_text_safety'),/owner/);
  await assert.rejects(db.exec('create or replace function ugc_text_is_prohibited_v1(text) returns boolean language sql as $$select false$$'),/permission denied|owner/);
  await assert.rejects(db.exec('select enforce_ugc_text_safety_v1()'),/permission denied/);
});
test('normal messages succeed and direct prohibited messages fail while history remains accessible', async () => {
  await message('Can I pick up the nail gun tomorrow?');
  await rejected(()=>message(forbidden));
  await actor(2);
  assert.equal((await rows('select body from messages')).length,2);
});
test('message edits are checked for trusted writers without granting client update access', async () => {
  await assert.rejects(db.query('update messages set body=$1',[forbidden]),/permission denied/);
  await db.exec('reset role');
  await rejected(()=>db.query('update messages set body=$1',[forbidden]));
});
test('checkout review RPC rejects prohibited text and preserves legitimate reviews and uniqueness', async () => {
  await rejected(()=>review(forbidden));
  await review('Great tools and easy pickup');
  await assert.rejects(review('Duplicate'),e=>e.code==='23505');
  assert.deepEqual((await rows('select avg(rating)::integer as rating,count(*)::integer as count from marketplace_reviews'))[0],{rating:5,count:1});
});
test('local review RPC rejects prohibited text and retains confirmation, participant and duplicate checks', async () => {
  await rejected(()=>localReview(forbidden));
  await localReview('Good transaction');
  await assert.rejects(localReview('Duplicate'),e=>e.code==='23505');
  await actor(3); await assert.rejects(localReview('Not a participant'),e=>e.code==='42501');
  await db.exec("reset role; update local_sale_confirmations set status='pending_buyer_confirmation'");
  await actor(2); await assert.rejects(localReview('Not confirmed'),e=>e.code==='55000');
});
test('checkout eligibility and prohibition of direct client review insertion remain enforced', async () => {
  await assert.rejects(db.query('insert into marketplace_reviews(order_id,reviewer_id,reviewee_id,direction,rating,body) values($1,$2,$3,$4,5,$5)',[id(201),id(1),id(2),'buyer_to_seller',forbidden]),/permission denied/);
  await actor(3); await assert.rejects(review('Not a participant'),e=>e.code==='42501');
  await db.exec("reset role; update orders set fulfillment_status='pending'");
  await actor(1); await assert.rejects(review('Not completed'),e=>e.code==='55000');
});
test('trusted direct review insertion and editing still pass through the text guard', async () => {
  await review('Good seller');
  await db.exec('reset role');
  await rejected(()=>db.query('update marketplace_reviews set body=$1',[forbidden]));
  await rejected(()=>db.query('insert into marketplace_reviews(order_id,reviewer_id,reviewee_id,direction,rating,body) values($1,$2,$3,$4,5,$5)',[id(201),id(2),id(1),'seller_to_buyer',forbidden]));
});
test('normal profile names, bios and private self data work with migration 045 grants', async () => {
  await db.query("update profiles set display_name='Tool Guy',username='tool_guy',bio='Nail gun enthusiast',postal_code='12345' where id=$1",[id(1)]);
  for (const field of ['display_name','username','bio']) await rejected(()=>db.query(`update profiles set ${field}=$1 where id=$2`,[forbidden,id(1)]));
  const profile=(await rows('select * from get_my_profile_v1()'))[0];
  assert.equal(profile.bio,'Nail gun enthusiast'); assert.equal(profile.postal_code,'12345');
});
test('profile inserts also pass through the text guard', async () => {
  await db.exec('reset role');
  await rejected(()=>db.query('insert into profiles(id,display_name) values($1,$2)',[id(4),forbidden]));
  assert.equal((await rows('select id from profiles')).length,3);
});
test('real signup profile trigger cannot insert prohibited display names', async () => {
  await db.exec('reset role');
  await rejected(()=>db.query('insert into auth.users values($1,$2)',[id(4),{display_name:forbidden,username:'new_user'}]));
  assert.equal((await rows('select id from auth.users')).length,0);
  await db.query('insert into auth.users values($1,$2)',[id(4),{display_name:'New Seller',username:'new_user'}]);
  assert.equal((await db.query('select display_name from profiles where id=$1',[id(4)])).rows[0].display_name,'New Seller');
});
test('blocking still rejects communication and preserves existing history', async () => {
  await block(2);
  await assert.rejects(message('Hello'),/SHEDMO_INTERACTION_UNAVAILABLE/);
  assert.equal((await rows('select body from messages')).length,1);
});
test('reports still accept quoted evidence of prohibited content', async () => {
  await db.query('select submit_content_report($1,$2,$3,$4)',['listing',id(1),'inappropriate',forbidden]);
  await db.exec('reset role');
  assert.equal((await rows('select id from reports')).length,1);
});
test('staff can hide historical prohibited content without deletion; restoring active content rechecks it', async () => {
  await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false); alter table listings disable trigger listings_ugc_text_safety");
  // Only the privileged local fixture models a pre-migration row this way.
  await db.query('update listings set title=$1 where id=$2',[forbidden,id(1)]);
  await db.exec('alter table listings enable trigger listings_ugc_text_safety');
  await db.query("insert into staff_roles(user_id,role) values($1,'moderator')",[id(3)]);
  await db.exec('set role service_role');
  await db.query("select staff_moderate_listing_v1($1,$2,'hide','Safety report reviewed')",[id(3),id(1)]);
  await rejected(()=>db.query("select staff_moderate_listing_v1($1,$2,'restore',null)",[id(3),id(1)]));
  await db.exec('reset role');
  assert.equal((await rows('select id from listings')).length,2);
  assert.equal((await rows('select id from staff_action_log')).length,1);
  await db.query("update listings set title='Safe tool' where id=$1",[id(1)]);
  await db.exec('set role service_role');
  await db.query("select staff_moderate_listing_v1($1,$2,'restore',null)",[id(3),id(1)]);
});
test('safe client errors and existing rules link cover each submission UI', () => {
  assert.equal(friendlyError('SHEDMO_CONTENT_NOT_ALLOWED'),CONTENT_SAFETY_MESSAGE);
  assert.equal(isContentSafetyError({message:'SHEDMO_CONTENT_NOT_ALLOWED'}),true);
  assert.equal(isContentSafetyError(new Error('SHEDMO_CONTENT_NOT_ALLOWED')),true);
  assert.equal(isContentSafetyError({message:CONTENT_SAFETY_MESSAGE}),true);
  assert.equal(isContentSafetyError({message:'SQL detail'}),false);
  assert.equal(isContentSafetyError(null),false);
  for (const path of ['sell/SellScreen.tsx','listings/EditListingScreen.tsx','account/LeaveReviewScreen.tsx','localSales/LocalSaleReviewScreen.tsx','profile/EditProfileScreen.tsx','messaging/ConversationScreen.tsx']) assert.match(read(`src/features/${path}`),/showContentSafetyAlert\(/);
  assert.match(read('src/features/safety/showContentSafetyAlert.ts'),/\/settings\/prohibited-items/);
  assert.match(read('src/features/sell/SellScreen.tsx'),/<ListingPhotoSafetyNotice/);
});

test('unchanged legacy reservations can be released while draft publication is checked', async () => {
  await db.exec('reset role; alter table listings disable trigger listings_ugc_text_safety');
  await db.query("update listings set title=$1,status='reserved' where id=$2",[forbidden,id(1)]);
  await db.exec('alter table listings enable trigger listings_ugc_text_safety');
  await actor(2);
  await db.query("update listings set status='active' where id=$1",[id(1)]);
  await db.query("update listings set status='draft' where id=$1",[id(1)]);
  await rejected(()=>db.query("update listings set status='active' where id=$1",[id(1)]));
  assert.equal((await db.query('select status from listings where id=$1',[id(1)])).rows[0].status,'draft');
});

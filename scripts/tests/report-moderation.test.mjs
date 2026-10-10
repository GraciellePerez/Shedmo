import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import vm from 'node:vm';
import ts from 'typescript';

const db = new PGlite();
const read = path => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/202609130043_add_user_blocking.sql');
const id = n => typeof n === 'string' ? n : `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
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
    create role authenticated; create role anon; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth; create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb default '{}'::jsonb);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon,service_role;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant select on storage.objects to anon;
    create policy fixture_storage_read on storage.objects for select to anon,authenticated using(true);

    create table auth.users(id uuid primary key, raw_user_meta_data jsonb, deleted_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth to authenticated, anon;
    create policy fixture_storage_insert on storage.objects for insert to authenticated with check(owner_id=auth.uid()::text);
    create table public.profiles(id uuid primary key, display_name text, username text, bio text, avatar_url text, city text, state text, postal_code text, created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.listings (
      id uuid primary key default gen_random_uuid(), seller_id uuid references public.profiles(id),
      title text, description text, category text, brand text, condition text, status text,
      price numeric, created_at timestamptz default now(), latitude double precision,
      longitude double precision, pickup_available boolean, shipping_available boolean,
      city text, state text, postal_code text, location_source text, location_updated_at timestamptz
    );
    create table public.listing_images(id uuid primary key default gen_random_uuid(),listing_id uuid references listings(id),storage_path text,sort_order integer default 0);
    alter table listing_images enable row level security;
    grant select,insert,update on listing_images to authenticated;
    create policy fixture_images_read on listing_images for select to authenticated using(true);
    create policy fixture_images_insert on listing_images for insert to authenticated with check(exists(select 1 from listings l where l.id=listing_id and l.seller_id=auth.uid()));
    create policy fixture_images_update on listing_images for update to authenticated using(exists(select 1 from listings l where l.id=listing_id and l.seller_id=auth.uid()));
    alter table public.listings enable row level security;
    create policy listing_read on public.listings for select to authenticated using (true);
    grant select,update on public.profiles to authenticated;
    grant select,insert,update on public.listings to authenticated;
    alter table profiles enable row level security;
    create policy profile_read on profiles for select to authenticated using(true);
    create policy profile_write on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
    create policy listing_insert on listings for insert to authenticated with check(seller_id=auth.uid());
    create policy listing_update on listings for update to authenticated using(seller_id=auth.uid()) with check(seller_id=auth.uid());
    create table orders(id uuid primary key,listing_id uuid,buyer_id uuid,seller_id uuid,fulfillment_status text,completed_at timestamptz);
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
  await db.exec(read('supabase/migrations/202609140044_harden_listing_image_authorization.sql'));
  await db.exec(read('supabase/migrations/202609150047_add_report_moderation_workflow.sql'));
  await db.exec(read('supabase/migrations/202609150048_protect_account_deletion_from_moderation.sql'));
  await db.exec(read('supabase/migrations/202609280052_add_private_chat_image_attachments.sql'));
  // Load the actual notification identity trigger, previously missing from the
  // deletion fixture (the old auxiliary-table stub hid its deterministic error).
  const notifications = read('supabase/migrations/202607290004_create_notifications.sql');
  await db.exec(notifications.slice(0, notifications.indexOf('create or replace function public.create_new_message_notification')));
  await db.exec(read('supabase/migrations/202607290001_create_favorites.sql').split('-- Active listings remain public')[0]);
  await db.exec(reviews.slice(reviews.indexOf('create table public.recently_viewed_listings'), reviews.indexOf('create function public.record_recent_listing_view')));
  await db.exec(reviews.slice(reviews.indexOf('create table public.marketplace_notification_events'),reviews.indexOf('create function public.search_marketplace_listings_v2')));
  const telemetry = read('supabase/migrations/202608060023_add_phase_g_beta_readiness.sql');
  await db.exec(telemetry.slice(0, telemetry.indexOf('alter table public.staff_action_log')));
  await db.exec(`create function public.set_profiles_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;`);
  await db.exec(read('supabase/migrations/202607290010_add_push_tokens.sql').split('-- Registration is the only')[0]);
  await db.exec('alter table orders add column payment_status text, add column dispute_status text, add column refund_status text;');
  await db.exec('create unique index fixture_profile_username_unique on profiles(username);');
  await db.exec(read('supabase/migrations/202610050054_atomic_account_deletion.sql'));
  await db.exec('grant usage on schema auth to supabase_auth_admin; grant select,update on auth.users to supabase_auth_admin;');

});
after(() => db.close());
beforeEach(async () => {
  await actor(1);
  await db.exec('reset role; truncate public.account_deletion_state, public.profiles, public.orders, auth.users,storage.objects,public.marketplace_analytics_events,public.marketplace_operational_errors,public.marketplace_beta_feedback,public.push_tokens cascade;');
  for (const n of [1, 2, 3]) await db.query('insert into profiles(id,display_name,username) values($1,$2,$3)', [id(n), `User ${n}`, `user${n}`]);
  for (let n = 1; n <= 2; n++) await db.query(`insert into listings
    (id,seller_id,title,description,category,condition,status,price,created_at,latitude,longitude,pickup_available,shipping_available)
    values ($1,$2,'Cordless drill','Working tool','tools','good','active',$3,$4,41,-87,true,false)`,
  [id(n), id(n % 2 ? 2 : 3), n, `2026-01-${String(1 + n % 20).padStart(2, '0')}T00:00:00Z`]);
  await db.query('insert into conversations(id,listing_id,buyer_id,seller_id) values($1,$2,$3,$4)', [id(101), id(1), id(1), id(2)]);
  await db.query("insert into orders(id,buyer_id,seller_id,fulfillment_status,completed_at,listing_id) values($1,$2,$3,'completed',now(),'00000000-0000-0000-0000-000000000001')",[id(201),id(1),id(2)]);
  await db.query("insert into local_sale_confirmations(id,listing_id,conversation_id,seller_id,buyer_id,status,listing_title_snapshot,listing_price_snapshot,seller_confirmed_at,buyer_confirmed_at) values($1,$2,$3,$4,$5,'confirmed','Drill',20,now(),now())",[id(301),id(1),id(101),id(2),id(1)]);
  await db.query("insert into staff_roles(user_id,role) values($1,'moderator')",[id(3)]);
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('listing-images',$1,$2)",[`${id(2)}/${id(1)}/photo.jpg`,id(2)]);
  await db.query('insert into listing_images(listing_id,storage_path) values($1,$2)',[id(1),`${id(2)}/${id(1)}/photo.jpg`]);
  await actor(2); await send(2);
  await actor(1);
});


const staff = async () => {
  await db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
};
const report = async (type,target,conversation=null) => {
  const result=await db.query('select submit_content_report($1,$2,$3,$4,$5) as result',[type,target,'other','Please inspect this content',conversation]);
  assert.equal(result.rows[0].result,'submitted');
  await staff();
  return (await db.query('select id from reports where report_type=$1 and target_id=$2',[type,target])).rows[0].id;
};
const inspect = async reportId => (await db.query('select staff_inspect_report_v1($1,$2) as data',[id(3),reportId])).rows[0].data;
const moderate = async (reportId,action='suppress',revision) => {
  const current=revision??(await inspect(reportId)).revision;
  return db.query('select staff_suppress_report_content_v1($1,$2,$3,$4,$5)',[id(3),reportId,action,'Confirmed rule violation',current]);
};
const forbiddenAccess = action => assert.rejects(action,e=>e.code==='42501');
const review = async () => (await db.query("select submit_marketplace_review($1,5::smallint,'Review under investigation') as id",[id(201)])).rows[0].id;
const reviewReport = async reviewId => {
  assert.equal((await db.query("select submit_review_report_v1($1,'inappropriate','Please review') as result",[reviewId])).rows[0].result,'submitted');
  await staff(); return (await db.query('select id from reports where review_id=$1',[reviewId])).rows[0].id;
};

test('staff inspects only the reported listing and its authorized photo paths',async()=>{
  const reportId=await report('listing',id(1));
  const result=await inspect(reportId);
  assert.equal(result.content.id,id(1)); assert.equal(result.content.title,'Cordless drill');
  assert.equal(result.content.images.length,1);
  assert.equal(result.content.images[0].path,`${id(2)}/${id(1)}/photo.jpg`);
  assert.ok(!('postal_code' in result.content));
});
test('ordinary users, anonymous callers and inactive staff cannot inspect private reports or evidence',async()=>{
  const reportId=await report('listing',id(1));
  await actor(1);
  await forbiddenAccess(()=>inspect(reportId));
  await forbiddenAccess(()=>db.exec('select * from reports'));
  await forbiddenAccess(()=>db.exec('select * from ugc_moderation_evidence'));
  await forbiddenAccess(()=>db.query('select ugc_report_content_v1($1)',[reportId]));
  await db.exec('reset role; set role anon'); await forbiddenAccess(()=>inspect(reportId));
  await staff(); await db.query('update staff_roles set active=false where user_id=$1',[id(3)]);
  await forbiddenAccess(()=>inspect(reportId));
});
test('reported message inspection contains the exact body and listing context, not a conversation dump',async()=>{
  const messageId=(await rows('select id from messages'))[0].id;
  const reportId=await report('message',messageId,id(101));
  const result=await inspect(reportId);
  assert.equal(result.content.body,'Hello'); assert.equal(result.content.sender_id,id(2));
  assert.equal(result.content.conversation_id,id(101)); assert.equal(result.content.listing_id,id(1));
  assert.ok(!('messages' in result.content));
  await actor(1); await forbiddenAccess(()=>inspect(reportId));
  await actor(3);
  assert.equal((await db.query("select submit_content_report('message',$1,'other','Unrelated conversation',$2) as result",[messageId,id(101)])).rows[0].result,'unavailable');
});
test('message suppression preserves private evidence and restores legitimate text',async()=>{
  const messageId=(await rows('select id from messages'))[0].id;
  const reportId=await report('message',messageId,id(101));
  await moderate(reportId);
  assert.equal((await inspect(reportId)).content.body,'Hello');
  await actor(1);
  assert.equal((await rows('select body from messages'))[0].body,'[Message removed by Shedmo]');
  await staff(); await moderate(reportId,'restore');
  await actor(1); assert.equal((await rows('select body from messages'))[0].body,'Hello');
});
test('review reports derive listing, reviewer and reporter instead of trusting client IDs',async()=>{
  const reviewId=await review();
  assert.equal((await db.query("select submit_review_report_v1($1,'other','My own review') as result",[reviewId])).rows[0].result,'invalid_target');
  await actor(2); const reportId=await reviewReport(reviewId);
  const row=(await db.query('select review_id,listing_id,reported_user_id,reporter_id from reports where id=$1',[reportId])).rows[0];
  assert.deepEqual(row,{review_id:reviewId,listing_id:id(1),reported_user_id:id(1),reporter_id:id(2)});
  assert.equal((await inspect(reportId)).content.body,'Review under investigation');
  await actor(2);
  assert.equal((await db.query("select submit_review_report_v1($1,'spam','Duplicate') as result",[reviewId])).rows[0].result,'duplicate');
  assert.equal((await db.query("select submit_review_report_v1($1,'spam','Unknown') as result",[id(999)])).rows[0].result,'unavailable');
  await assert.rejects(db.query("select submit_review_report_v1('invalid','spam',null)"),e=>e.code==='22P02');
});
test('suppressed reviews disappear from direct selects, public RPC and seller aggregates',async()=>{
  const reviewId=await review(); await actor(2); const reportId=await reviewReport(reviewId);
  await moderate(reportId);
  await actor(1);
  assert.equal((await rows('select * from marketplace_reviews')).length,0);
  assert.equal((await db.query('select * from get_profile_reviews($1)',[id(2)])).rows.length,0);
  assert.equal(Number((await db.query('select total_reviews from get_public_seller_profile_v2($1)',[id(2)])).rows[0].total_reviews),0);
  await staff(); await moderate(reportId,'restore');
  await actor(1); assert.equal((await rows('select * from marketplace_reviews')).length,1);
});
test('local-sale reviews derive their correct listing and can be reported',async()=>{
  const reviewId=(await db.query("select submit_local_sale_review_v1($1,5::smallint,'Good transaction') as id",[id(301)])).rows[0].id;
  await actor(2); const reportId=await reviewReport(reviewId);
  assert.equal((await inspect(reportId)).content.listing_id,id(1));
});
test('listing takedown blocks owner, public and historical image paths without changing transaction status',async()=>{
  const reportId=await report('listing',id(1));
  await db.exec('reset role'); await db.query("update listings set status='sold' where id=$1",[id(1)]);
  await staff(); await moderate(reportId);
  assert.equal((await inspect(reportId)).content.status,'sold');
  for(const n of [1,2,3]){
    await actor(n);
    assert.equal((await db.query('select id from listings where id=$1',[id(1)])).rows.length,0);
    assert.equal((await rows('select * from listing_images')).length,0);
    assert.equal((await rows("select name from storage.objects where bucket_id='listing-images'")).length,0);
  }
  await db.exec('reset role; set role anon');
  await forbiddenAccess(()=>rows('select name from storage.objects'));
  await staff(); await moderate(reportId,'restore');
  await actor(1); assert.equal((await db.query('select status from listings where id=$1',[id(1)])).rows[0].status,'sold');
});
test('profile intervention masks public text while preserving private self fields and evidence',async()=>{
  await actor(2); await db.query("update profiles set bio='Profile under investigation',postal_code='12345' where id=$1",[id(2)]);
  await actor(1); const reportId=await report('seller',id(2));
  assert.ok(!('postal_code' in (await inspect(reportId)).content));
  await moderate(reportId);
  await actor(2);
  const profile=(await rows('select * from get_my_profile_v1()'))[0];
  assert.equal(profile.bio,null);assert.equal(profile.postal_code,'12345');assert.equal(profile.display_name,'Shedmo member');
  await forbiddenAccess(()=>db.exec('select moderation_hidden_at from profiles'));
  await forbiddenAccess(()=>db.query("update profiles set bio='Circumvent suppression' where id=$1",[id(2)]));
  await staff();await moderate(reportId,'restore');
  assert.equal((await inspect(reportId)).content.bio,'Profile under investigation');
});
test('moderation flags cannot be forged by ordinary users',async()=>{
  await forbiddenAccess(()=>db.query('update profiles set moderation_hidden_at=now() where id=$1',[id(1)]));
  await forbiddenAccess(()=>db.query('update messages set moderation_hidden_at=now()'));
  await forbiddenAccess(()=>db.query('update marketplace_reviews set moderation_hidden_at=now()'));
});
test('staff actions retain report-linked actor, outcome, note and timestamp; stale decisions are rejected',async()=>{
  const reportId=await report('listing',id(1));const revision=(await inspect(reportId)).revision;
  await db.exec('reset role');await db.query("update listings set title='Changed after inspection' where id=$1",[id(1)]);
  await staff();await assert.rejects(moderate(reportId,'suppress',revision),e=>e.code==='40001');
  await moderate(reportId);
  await moderate(reportId);
  const history=(await inspect(reportId)).history;
  assert.ok(history.some(row=>row.actor===id(3)&&row.action==='ugc_suppress'&&row.outcome==='suppressed'&&row.note==='Confirmed rule violation'&&row.timestamp));
  assert.ok(history.some(row=>row.outcome==='already_suppressed'));
  await actor(1);await forbiddenAccess(()=>db.exec('select * from staff_action_log'));
});
test('blocking and 046 still reject prohibited activity after moderation migration',async()=>{
  await block(2);await assert.rejects(send(1),/SHEDMO_INTERACTION_UNAVAILABLE/);await block(2,false);await send(1);
  await assert.rejects(db.query('insert into messages(conversation_id,sender_id,body) values($1,$2,$3)',[id(101),id(1),'I will kill you']),/SHEDMO_CONTENT_NOT_ALLOWED/);
  assert.equal((await rows('select id from messages')).length,2);
});
test('participants send and read private image messages while unrelated users cannot access storage',async()=>{
  await db.exec('reset role');
  const bucket=(await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='chat-images'")).rows[0];
  assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),5242880);
  assert.deepEqual(bucket.allowed_mime_types,['image/jpeg']);
  await actor(2);
  const uploadId=id(901);
  const reservation=(await db.query('select create_chat_image_upload_v1($1,$2) as result',[id(101),uploadId])).rows[0].result;
  const path=`${id(101)}/${id(2)}/${uploadId}.jpg`;
  assert.equal(reservation.storage_path,path);
  await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('chat-images',$1,$2,$3::jsonb)",
    [path,id(2),JSON.stringify({mimetype:'image/jpeg',size:128})]);
  const sent=(await db.query('select send_chat_image_v1($1,$2) as message',[uploadId,'Photo caption'])).rows[0].message;
  assert.equal(sent.attachment_path,path);assert.equal(sent.body,'Photo caption');
  const repeated=(await db.query('select send_chat_image_v1($1,$2) as message',[uploadId,'Photo caption'])).rows[0].message;
  assert.equal(repeated.id,uploadId);
  assert.equal((await db.query('select id from messages where id=$1',[uploadId])).rows.length,1);
  await actor(1);
  assert.equal((await db.query('select name from storage.objects where bucket_id=$1',[ 'chat-images' ])).rows.length,1);
  await actor(3);
  assert.equal((await db.query('select name from storage.objects where bucket_id=$1',[ 'chat-images' ])).rows.length,0);
  await forbiddenAccess(()=>db.query('select create_chat_image_upload_v1($1,$2)',[id(101),id(902)]));
});
test('server rejects cross-conversation object attachment, blocked image sends, and forged uploads',async()=>{
  await actor(2);
  await db.query('insert into conversations(id,listing_id,buyer_id,seller_id) values($1,$2,$3,$4)',[id(102),id(2),id(2),id(3)]);
  const uploadId=id(903);
  const path=`${id(101)}/${id(2)}/${uploadId}.jpg`;
  await db.query('select create_chat_image_upload_v1($1,$2)',[id(101),uploadId]);
  await forbiddenAccess(()=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('chat-images',$1,$2,$3::jsonb)",
    [`${id(102)}/${id(2)}/${id(904)}.jpg`,id(2),JSON.stringify({mimetype:'image/jpeg',size:128})]));
  await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('chat-images',$1,$2,$3::jsonb)",
    [path,id(2),JSON.stringify({mimetype:'image/jpeg',size:128})]);
  await forbiddenAccess(()=>db.query(`insert into messages(id,conversation_id,sender_id,body,attachment_path,attachment_mime_type,attachment_size_bytes)
    values($1,$2,$3,'',$4,'image/jpeg',128)`,[uploadId,id(102),id(2),path]));
  await block(1);
  await assert.rejects(db.query('select send_chat_image_v1($1,null)',[uploadId]),/SHEDMO_INTERACTION_UNAVAILABLE/);
  assert.equal((await db.query('select id from messages where id=$1',[uploadId])).rows.length,0);
});
test('reported chat images are inspectable by staff and unavailable after moderation suppression',async()=>{
  await actor(2);
  const uploadId=id(905),path=`${id(101)}/${id(2)}/${id(905)}.jpg`;
  await db.query('select create_chat_image_upload_v1($1,$2)',[id(101),uploadId]);
  await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('chat-images',$1,$2,$3::jsonb)",
    [path,id(2),JSON.stringify({mimetype:'image/jpeg',size:256})]);
  await db.query('select send_chat_image_v1($1,null)',[uploadId]);
  await actor(1);
  const reportId=await report('message',uploadId,id(101));
  assert.equal((await inspect(reportId)).content.attachment_path,path);
  await moderate(reportId);
  await actor(1);
  await forbiddenAccess(()=>db.exec('select * from chat_attachment_report_evidence'));
  assert.equal((await db.query('select name from storage.objects where bucket_id=$1',[ 'chat-images' ])).rows.length,0);
  assert.equal((await db.query('select id from messages where id=$1',[uploadId])).rows.length,1);
  await staff();
  assert.equal((await inspect(reportId)).content.attachment_path,path);
  await db.exec('reset role');
  await db.query('delete from messages where id=$1',[uploadId]);
  await actor(2);
  await db.query('delete from storage.objects where bucket_id=$1 and name=$2',['chat-images',path]);
  await db.exec('reset role');
  assert.equal((await db.query("select name from storage.objects where bucket_id='chat-images' and name=$1",[path])).rows.length,1);
  await staff();
  assert.equal((await inspect(reportId)).content.attachment_path,path);
});
test('database rejects non-JPEG and over-limit chat objects before creating messages',async()=>{
  await actor(2);
  for(const [uploadId,mime,size] of [[id(915),'image/png',128],[id(916),'image/jpeg',5242881]]){
    const path=`${id(101)}/${id(2)}/${uploadId}.jpg`;
    await db.query('select create_chat_image_upload_v1($1,$2)',[id(101),uploadId]);
    await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('chat-images',$1,$2,$3::jsonb)",
      [path,id(2),JSON.stringify({mimetype:mime,size})]);
    await assert.rejects(db.query('select send_chat_image_v1($1,null)',[uploadId]));
    assert.equal((await db.query('select id from messages where id=$1',[uploadId])).rows.length,0);
  }
});
test('044 rejects forged image associations and staff inspection never signs those paths',async()=>{
  await actor(2);
  await forbiddenAccess(()=>db.query('insert into listing_images(listing_id,storage_path) values($1,$2)',[id(1),`${id(3)}/${id(2)}/photo.jpg`]));
  await actor(1);const reportId=await report('listing',id(1));
  await db.exec('reset role');
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('listing-images',$1,$2)",[`${id(3)}/${id(2)}/photo.jpg`,id(3)]);
  // Model a forged pre-044 metadata row in the isolated fixture only.
  await db.query('insert into listing_images(listing_id,storage_path,sort_order) values($1,$2,1)',[id(1),`${id(3)}/${id(2)}/photo.jpg`]);
  await staff();assert.equal((await inspect(reportId)).content.images.length,1);
});

test('legacy listing restore cannot bypass report moderation or 046 restoration checks',async()=>{
  const reportId=await report('listing',id(1));
  await db.exec('reset role; alter table listings disable trigger listings_ugc_text_safety');
  await db.query("update listings set title='I will kill you' where id=$1",[id(1)]);
  await db.exec('alter table listings enable trigger listings_ugc_text_safety');
  await staff();await moderate(reportId);
  await assert.rejects(db.query("select staff_moderate_listing_v1($1,$2,'restore',null)",[id(3),id(1)]),/associated report/);
  await assert.rejects(moderate(reportId,'restore'),/SHEDMO_CONTENT_NOT_ALLOWED/);
  assert.equal((await inspect(reportId)).suppressed,true);
});
test('repeated moderation retains private evidence versions and resolution records',async()=>{
  const messageId=(await rows('select id from messages'))[0].id;
  const reportId=await report('message',messageId,id(101));
  await moderate(reportId);await moderate(reportId,'restore');await moderate(reportId);
  await db.query("select staff_moderate_report_v1($1,$2,'resolved','Suppressed offending message')",[id(3),reportId]);
  const result=await inspect(reportId);
  assert.equal(result.status,'resolved');assert.equal(result.resolution_note,'Suppressed offending message');
  await db.exec('reset role');
  const evidence=await rows('select active,snapshot from ugc_moderation_evidence');
  assert.equal(evidence.length,2);assert.equal(evidence.filter(e=>e.active).length,1);
  assert.ok(evidence.every(e=>e.snapshot.body==='Hello'));
});
test('untargeted messages, listings, profile privacy and review eligibility survive suppression',async()=>{
  const reviewId=await review();await actor(2);const reportId=await reviewReport(reviewId);
  await moderate(reportId);await actor(1);
  await assert.rejects(db.query("select submit_marketplace_review($1,5::smallint,'Duplicate despite suppression')",[id(201)]),e=>e.code==='23505');
  await send(1);assert.equal((await rows('select id from messages')).length,2);
  assert.equal((await rows('select id from listings')).length,2);
  await forbiddenAccess(()=>db.exec('select postal_code from profiles'));
  await forbiddenAccess(()=>db.exec('select account_suspended_at from profiles'));
  assert.equal((await rows('select * from get_my_profile_v1()')).length,1);
});

test('moderation restore cannot republish data anonymized by existing account deletion',async()=>{
  const reviewId=await review();await actor(2);const reportId=await reviewReport(reviewId);
  await moderate(reportId);
  await db.query('select record_account_deletion_v1($1)',[id(1)]);
  await db.exec('reset role');
  await db.query("update profiles set display_name='Deleted member',username=$1,bio=null,avatar_url=null where id=$2",[`deleted_${id(1).replaceAll('-','').slice(0,12)}`,id(1)]);
  await staff();await assert.rejects(moderate(reportId,'restore'),/Deleted account content/);
  assert.equal((await inspect(reportId)).suppressed,true);
});

const tombstone = async n => {
  await db.exec('reset role');
  return (await db.query('select * from account_deletion_state where user_id=$1',[id(n)])).rows[0];
};
test('original deletion exploit stays blocked after seller profile suppression overwrites public markers',async()=>{
  const reviewId=await review(); await actor(2); const reviewReportId=await reviewReport(reviewId);
  await moderate(reviewReportId);
  await actor(2); const sellerReportId=await report('seller',id(1));
  await db.query('select record_account_deletion_v1($1)',[id(1)]);
  const state=await tombstone(1);
  await db.query("update profiles set display_name='Deleted member',username=$1,bio=null,avatar_url=null,city=null,state=null where id=$2",[`deleted_${id(1).replaceAll('-','').slice(0,12)}`,id(1)]);
  await db.query('update marketplace_reviews set body=null where reviewer_id=$1',[id(1)]);
  await staff(); await assert.rejects(moderate(reviewReportId,'restore'),/Deleted account content/);
  await moderate(sellerReportId);
  assert.deepEqual(await tombstone(1),state); await staff();
  await assert.rejects(moderate(reviewReportId,'restore'),/Deleted account content/);
  await assert.rejects(moderate(sellerReportId,'restore'),/Deleted account content/);
  await actor(2);
  assert.equal((await db.query('select body from marketplace_reviews where id=$1',[reviewId])).rows.length,0);
  assert.equal((await db.query('select display_name,username from profiles where id=$1',[id(1)])).rows[0].display_name,'Shedmo member');
  await forbiddenAccess(()=>db.exec('select * from ugc_moderation_evidence'));
  await db.exec('reset role');
  assert.equal((await db.query('select body from marketplace_reviews where id=$1',[reviewId])).rows[0].body,null);
  assert.equal((await db.query("select snapshot->>'body' as body from ugc_moderation_evidence where target_type='review' and target_id=$1",[reviewId])).rows[0].body,'Review under investigation');
});
test('deletion state is private, append-only through the service API, and cannot be cleared by public edits',async()=>{
  await forbiddenAccess(()=>db.query('select record_account_deletion_v1($1)',[id(1)]));
  await staff(); await db.query('select record_account_deletion_v1($1)',[id(1)]);
  const state=await tombstone(1); await staff();
  await db.query('select record_account_deletion_v1($1)',[id(1)]);
  for(const role of ['authenticated','service_role']){
    await db.exec(`reset role; set role ${role}`);
    await forbiddenAccess(()=>db.exec('select * from account_deletion_state'));
    await forbiddenAccess(()=>db.exec('delete from account_deletion_state'));
    await forbiddenAccess(()=>db.exec('update account_deletion_state set recorded_at=now()'));
    await forbiddenAccess(()=>db.query('insert into account_deletion_state(user_id) values($1)',[id(2)]));
  }
  await actor(1);
  await forbiddenAccess(()=>db.query("update profiles set display_name='New name' where id=$1",[id(1)]));
  await forbiddenAccess(()=>db.query("update profiles set username='newname' where id=$1",[id(1)]));
  assert.deepEqual(await tombstone(1),state);
});
test('deleted content cannot be restored through legacy listing actions or direct service updates',async()=>{
  const reviewId=await review(); await actor(2); const rid=await reviewReport(reviewId); await moderate(rid);
  await db.query('select record_account_deletion_v1($1)',[id(1)]);
  await db.exec('reset role');
  await forbiddenAccess(()=>db.query("update marketplace_reviews set body='Recovered evidence',moderation_hidden_at=null where id=$1",[reviewId]));
  await staff(); await db.query("select staff_moderate_listing_v1($1,$2,'hide','Test')",[id(3),id(1)]);
  await db.query('select record_account_deletion_v1($1)',[id(2)]);
  await assert.rejects(db.query("select staff_moderate_listing_v1($1,$2,'restore',null)",[id(3),id(1)]),/Deleted account content/);
});
test('message cleanup remains possible but restoring its evidence after deletion fails',async()=>{
  const messageId=(await rows('select id from messages'))[0].id;
  const rid=await report('message',messageId,id(101)); await moderate(rid);
  await db.query('select record_account_deletion_v1($1)',[id(2)]);
  await db.exec('reset role');
  await db.query("update messages set body='Message removed after account deletion.',deleted_at=now() where id=$1",[messageId]);
  await staff(); await assert.rejects(moderate(rid,'restore'),/Deleted account content/);
  await actor(1); assert.equal((await rows('select body from messages'))[0].body,'Message removed after account deletion.');
});
test('private Auth deletion state is authoritative even without a local tombstone',async()=>{
  const rid=await report('seller',id(2)); await moderate(rid);
  await db.exec('reset role');
  await db.exec('alter table auth.users disable trigger user');
  await db.query("insert into auth.users(id,deleted_at) values($1,now())",[id(2)]);
  await db.exec('alter table auth.users enable trigger user');
  await staff(); await assert.rejects(moderate(rid,'restore'),/Deleted account content/);
});
test('account deletion records durable state after eligibility checks and before cleanup',()=>{
  const edge=read('supabase/functions/delete-account/index.ts');
  const marker=edge.indexOf('admin.rpc("record_account_deletion_v1"');
  assert.ok(marker>edge.indexOf('Resolve active transactions'));
  assert.ok(marker<edge.indexOf('const { data: listings'));
  assert.ok(marker<edge.indexOf('admin.auth.admin.deleteUser'));
});

// Run the actual Edge handler. UGC/profile/listing cleanup uses the real local SQL
// and triggers; Storage/Auth/auxiliary telemetry are simulated, never remote.
async function deletionHandler(owner, { failListingCleanupOnce = false, failAuthAfterCleanupOnce = false, failStorageOnce = false } = {}) {
  await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false)");
  await db.exec('alter table auth.users disable trigger user');
  await db.query('insert into auth.users(id) values($1) on conflict do nothing',[id(owner)]);
  await db.exec('alter table auth.users enable trigger user');
  const calls=[],storageRemovals=[];
  let failNext=failListingCleanupOnce;
  let failAuth=failAuthAfterCleanupOnce, failStorage=failStorageOnce;
  const sqlTables=new Set(['listings','listing_images','profiles','messages','conversations','reports','chat_image_upload_reservations','marketplace_reviews','staff_roles','conversation_reads']);
  const admin={
    rpc: async (name,args)=>{
      assert.equal(name,'record_account_deletion_v1'); calls.push('record');
      await db.query('select record_account_deletion_v1($1)',[args.p_user_id]);
      return {error:null};
    },
    storage:{from:bucket=>({list:async()=>({data:[],error:null}),remove:async paths=>{if(failStorage){failStorage=false;return {error:{message:'Storage unavailable'}};}storageRemovals.push({bucket,paths});return {error:null};}})},
    auth:{admin:{deleteUser:async(user,soft)=>{
      assert.equal(user,id(owner)); assert.equal(soft,true); calls.push('auth-delete');
      try {
        if (failNext) {
          failNext=false;
          // Fail after the profile update inside the real transaction.
          await db.exec(`create function public.fixture_fail_cleanup() returns trigger language plpgsql as $$ begin raise exception 'Simulated transient cleanup failure'; end $$;
            create trigger fixture_fail_cleanup before update on public.listings for each row execute function public.fixture_fail_cleanup();`);
        }
        await db.transaction(async tx=>{
          await tx.exec("set local role supabase_auth_admin; select set_config('request.jwt.claim.role','',true);");
          await tx.query('update auth.users set deleted_at=coalesce(deleted_at,now()) where id=$1',[user]);
          assert.equal((await tx.query("select current_setting('request.jwt.claim.role') as role")).rows[0].role,'');
          if(failAuth){failAuth=false;throw new Error('Simulated Auth identity/session failure');}
        });
        return {error:null};
      } catch(error) { return {error}; }
      finally { await db.exec('drop trigger if exists fixture_fail_cleanup on public.listings; drop function if exists public.fixture_fail_cleanup();'); }
    }}},
    from(table){
      let operation='select',columns='*',values,head=false;
      const predicates=[];
      const notNullPredicates=[];
      const q={
        select(value,options){columns=value;head=!!options?.head;return q;},
        update(value){operation='update';values=value;return q;},
        delete(){operation='delete';return q;},
        eq(column,value){predicates.push([column,[value]]);return q;},
        in(column,value){predicates.push([column,value]);return q;},
        not(column,operator,value){
          assert.equal(operator,'is'); assert.equal(value,null);
          notNullPredicates.push(column);return q;
        },
        or(){return q;},
        then(resolve,reject){return (async()=>{
          // Transaction eligibility and non-UGC side effects are outside this regression.
          if(head)return {count:0,data:null,error:null};
          if(!sqlTables.has(table))return {data:[],error:null};
          const params=[];
          const bind=value=>{params.push(value);return '$'+params.length;};
          const fields=operation==='update'?Object.entries(values).map(([key,value])=>key+'='+bind(value)).join(','):'';
          const whereParts=predicates.map(([key,items])=>key+' in ('+items.map(bind).join(',')+')');
          whereParts.push(...notNullPredicates.map(key=>key+' is not null'));
          const where=whereParts.join(' and ');
          const sql=(operation==='select'?'select '+columns+' from '+table:operation==='delete'?'delete from '+table:'update '+table+' set '+fields)+(where?' where '+where:'');
          try { const result=await db.query(sql,params); return {data:result.rows,error:null}; }
          catch(error){return {error};}
        })().then(resolve,reject);},
      };return q;
    },
  };
  let handler;
  const compiled=ts.transpileModule(read('supabase/functions/delete-account/index.ts'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(compiled,{
    exports:{},Deno:{serve:fn=>{handler=fn;}},console:{error(){}},
    require:name=>{
      if(name.endsWith('/http.ts'))return {json:(body,status=200)=>({body,status}),optionsResponse:()=>({status:204}),safeErrorCode:()=> 'TEST'};
      if(name.endsWith('/server.ts'))return {createSupabaseAdminClient:()=>admin,requireAuthenticatedUser:async()=>({id:id(owner)})};
      throw new Error('Unexpected import '+name);
    },
  });
  return {calls,storageRemovals,run:()=>handler({method:'POST',json:async()=>({confirmation:'DELETE'})})};
}

test('account deletion removes unreported chat photos and preserves reported photo evidence',async()=>{
  const uploadImage=async(sender,message)=>{
    await actor(sender);
    const path=`${id(101)}/${id(sender)}/${id(message)}.jpg`;
    await db.query('select create_chat_image_upload_v1($1,$2)',[id(101),id(message)]);
    await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('chat-images',$1,$2,$3::jsonb)",
      [path,id(sender),JSON.stringify({mimetype:'image/jpeg',size:192})]);
    await db.query('select send_chat_image_v1($1,$2)',[id(message),sender===2?'Original report caption':null]);
    return path;
  };
  const retainedPath=await uploadImage(2,913);
  const removedPath=await uploadImage(1,914);
  await actor(1);
  const retainedReport=await report('message',id(913),id(101));
  const endpoint=await deletionHandler(2);
  assert.equal((await endpoint.run()).status,200);
  const removed=endpoint.storageRemovals.flatMap(item=>item.bucket==='chat-images'?item.paths:[]);
  assert.ok(removed.includes(removedPath));
  assert.ok(!removed.includes(retainedPath));
  assert.equal((await inspect(retainedReport)).content.body,'Original report caption');
  assert.equal((await db.query("select snapshot->>'attachment_path' as path from chat_attachment_report_evidence where report_id=$1",[retainedReport])).rows[0].path,retainedPath);
});

for(const [label,title,description] of [
  ['prohibited title','I will kill you','Legacy tool description'],
  ['prohibited description','Legacy tool','I will kill you'],
  ['prohibited title and description','I will kill you','I will kill you'],
  ['normal listing','Cordless drill','Working tool description'],
]){
  test('actual deletion handler anonymizes '+label+' and retries safely',async()=>{
    await db.exec('reset role; alter table listings disable trigger listings_ugc_text_safety');
    // Model a historical row created before 046, then restore enforcement immediately.
    await db.query('update listings set title=$1,description=$2 where id=$3',[title,description,id(1)]);
    await db.exec('alter table listings enable trigger listings_ugc_text_safety');
    const endpoint=await deletionHandler(2);
    assert.equal((await endpoint.run()).status,200);
    const state=await tombstone(2);
    assert.ok(state); assert.equal(endpoint.calls.at(-1),'auth-delete');
    assert.ok((await db.query('select deleted_at from auth.users where id=$1',[id(2)])).rows[0].deleted_at);
    await actor(1);
    const row=(await db.query('select title,description,status from listings where id=$1',[id(1)])).rows[0];
    assert.equal(row.title,'Removed listing');assert.equal(row.description,'Removed after account deletion.');assert.equal(row.status,'archived');
    await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false)");
    // Simulate a repeated trusted cleanup request; real Auth may reject a deleted session.
    assert.equal((await endpoint.run()).status,200);
    assert.deepEqual(await tombstone(2),state);
    assert.equal((await db.query('select display_name from profiles where id=$1',[id(2)])).rows[0].display_name,'Deleted member');
  });
}
test('actual deletion handler resumes partial cleanup across multiple listings and retains restore protection',async()=>{
  const rid=await report('listing',id(1)); await moderate(rid);
  await db.exec("reset role; alter table listings disable trigger listings_ugc_text_safety");
  await db.query("update listings set title='I will kill you' where id=$1",[id(1)]);
  await db.query("insert into listings(id,seller_id,title,description,category,status) values($1,$2,'I will kill you','Old description','tools','active')",[id(9),id(2)]);
  await db.exec('alter table listings enable trigger listings_ugc_text_safety');
  const endpoint=await deletionHandler(2,{failListingCleanupOnce:true});
  assert.equal((await endpoint.run()).status,500);
  assert.ok(await tombstone(2));
  assert.equal((await db.query('select deleted_at from auth.users where id=$1',[id(2)])).rows[0].deleted_at,null);
  assert.equal((await db.query('select display_name from profiles where id=$1',[id(2)])).rows[0].display_name,'User 2');
  await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false)");
  assert.equal((await endpoint.run()).status,200);
  const owned=(await db.query('select title,description from listings where seller_id=$1',[id(2)])).rows;
  assert.equal(owned.length,2);assert.ok(owned.every(row=>row.title==='Removed listing'&&row.description==='Removed after account deletion.'));
  await staff(); await assert.rejects(moderate(rid,'restore'),/Deleted account content/);
});
test('actual deletion handler supports an account with no listings',async()=>{
  const endpoint=await deletionHandler(1);
  assert.equal((await endpoint.run()).status,200);
  assert.ok(await tombstone(1));assert.equal(endpoint.calls.at(-1),'auth-delete');
});

test('deleting again with a new UUID clears actor notifications without affecting retained records',async()=>{
  // Same account signup metadata, two different Auth identities. The second
  // identity has actor notifications, which deterministically broke the old flow.
  for (const [attempt,n] of ['40000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000005'].entries()) {
    await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false)");
    await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',
      [id(n),{display_name:'Recreated account',username:'recreated'}]);
    if(attempt===1) await db.query(`insert into notifications(user_id,actor_id,type,title,body,listing_id)
      values($1,$2,'listing_favorited','Saved listing','A member saved your listing',$3)`,[id(1),id(n),id(1)]);
    const endpoint=await deletionHandler(n);
    assert.equal((await endpoint.run()).status,200);
    const profile=(await db.query('select display_name,username,bio,account_suspended_at from profiles where id=$1',[id(n)])).rows[0];
    assert.equal(profile.display_name,'Deleted member');
    assert.equal(profile.username,'deleted_'+id(n).replaceAll('-','').slice(0,12));
    assert.equal(profile.bio,null);assert.ok(profile.account_suspended_at);
    assert.ok((await db.query('select deleted_at from auth.users where id=$1',[id(n)])).rows[0].deleted_at);
    assert.ok(await tombstone(n));
  }
  const notification=(await db.query('select actor_id,title,body from notifications where user_id=$1',[id(1)])).rows[0];
  assert.equal(notification.actor_id,null);assert.equal(notification.title,'Saved listing');
  assert.equal((await db.query('select count(*)::int as n from orders')).rows[0].n,1);
});

test('late Auth failure rolls back all database cleanup and retry completes it',async()=>{
  await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false)");
  await db.query(`insert into notifications(user_id,actor_id,type,title,body,listing_id)
    values($1,$2,'listing_favorited','Saved','A member saved your listing',$3)`,[id(1),id(2),id(1)]);
  await db.query('insert into favorites(user_id,listing_id) values($1,$2)',[id(2),id(1)]);
  await db.query('insert into recently_viewed_listings(user_id,listing_id) values($1,$2)',[id(2),id(1)]);
  await db.query(`insert into marketplace_operational_errors(user_id,source,error_code) values($1,'app','TEST')`,[id(2)]);
  await db.query(`insert into marketplace_beta_feedback(user_id,category,description) values($1,'bug','Original feedback text')`,[id(2)]);
  await db.query(`insert into push_tokens(user_id,expo_push_token,platform,device_id,app_version)
    values($1,'ExpoPushToken[original]','ios','device','1')`,[id(2)]);
  const endpoint=await deletionHandler(2,{failAuthAfterCleanupOnce:true});
  assert.equal((await endpoint.run()).status,500);
  assert.equal((await db.query('select deleted_at from auth.users where id=$1',[id(2)])).rows[0].deleted_at,null);
  assert.equal((await db.query('select display_name from profiles where id=$1',[id(2)])).rows[0].display_name,'User 2');
  assert.equal((await db.query('select actor_id from notifications')).rows[0].actor_id,id(2));
  assert.equal((await db.query('select expo_push_token from push_tokens')).rows[0].expo_push_token,'ExpoPushToken[original]');
  assert.equal((await db.query('select count(*)::int as n from favorites')).rows[0].n,1);
  assert.equal((await endpoint.run()).status,200);
  assert.equal((await db.query('select actor_id from notifications')).rows[0].actor_id,null);
  assert.equal((await db.query('select user_id from marketplace_operational_errors')).rows[0].user_id,null);
  assert.equal((await db.query('select description from marketplace_beta_feedback')).rows[0].description,'Removed after account deletion.');
  const token=(await db.query('select * from push_tokens')).rows[0];
  assert.ok(token.disabled_at);assert.equal(token.device_id,null);assert.equal(token.app_version,null);
  for(const table of ['favorites','recently_viewed_listings']) {
    assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n,0);
  }
});

test('storage failure leaves profile and Auth unchanged and retries with the same marker',async()=>{
  const endpoint=await deletionHandler(1,{failStorageOnce:true});
  assert.equal((await endpoint.run()).status,500);
  const state=await tombstone(1);assert.ok(state);
  assert.equal((await db.query('select display_name from profiles where id=$1',[id(1)])).rows[0].display_name,'User 1');
  assert.equal((await db.query('select deleted_at from auth.users where id=$1',[id(1)])).rows[0].deleted_at,null);
  assert.equal((await endpoint.run()).status,200);assert.deepEqual(await tombstone(1),state);
});

test('notification privacy exception cannot change identity or clear an undeleted actor',async()=>{
  await db.exec('reset role');
  await db.query(`insert into notifications(user_id,actor_id,type,title,body,listing_id)
    values($1,$2,'listing_favorited','Saved','A member saved your listing',$3)`,[id(1),id(2),id(1)]);
  await actor(1);
  await db.exec('update notifications set is_read=true');
  await assert.rejects(db.exec('update notifications set actor_id=null'),/permission denied/);
  await db.exec("reset role; select set_config('request.jwt.claim.role','service_role',false)");
  await assert.rejects(db.exec('update notifications set actor_id=null'),/Only notification read state/);
  await db.query('select record_account_deletion_v1($1)',[id(2)]);
  await assert.rejects(db.exec("update notifications set actor_id=null,title='Changed'"),/Only notification read state/);
  await db.exec('update notifications set actor_id=null');
  await actor(1);
  await forbiddenAccess(()=>db.exec('select public.finalize_account_deletion_v1()'));
});
test('ordinary direct listing writes still cannot publish prohibited titles or descriptions',async()=>{
  await actor(2);
  await assert.rejects(db.query("insert into listings(seller_id,title,description,category,status) values($1,'I will kill you','Normal description','tools','draft')",[id(2)]),/SHEDMO_CONTENT_NOT_ALLOWED/);
  await assert.rejects(db.query("update listings set title='I will kill you' where id=$1",[id(1)]),/SHEDMO_CONTENT_NOT_ALLOWED/);
  await assert.rejects(db.query("update listings set description='I will kill you' where id=$1",[id(1)]),/SHEDMO_CONTENT_NOT_ALLOWED/);
});

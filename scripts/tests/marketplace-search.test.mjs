import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { sortListings } from '../../src/features/browse/listingSort.ts';

const db = new PGlite();
const migration = readFileSync('supabase/migrations/202609090042_improve_marketplace_search.sql', 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

before(async () => {
  // Minimal listing fixture, with RLS exercised as a non-owner role below.
  // Execute the actual migration: matching is never reimplemented in JavaScript.
  await db.exec(`
    create role authenticated;
    create role anon;
    create table public.listings (
      id uuid primary key, title text, description text, category text, brand text,
      condition text, status text, price numeric, created_at timestamptz,
      latitude double precision, longitude double precision,
      pickup_available boolean, shipping_available boolean,
      visible boolean default true
    );
    alter table public.listings enable row level security;
    create policy test_visibility on public.listings for select to authenticated using (visible);
    grant select on public.listings to authenticated;
  `);
  await db.exec(migration);
});
after(() => db.close());
beforeEach(async () => { await db.exec('reset role; truncate public.listings'); });

async function listing(n, title, overrides = {}) {
  const row = {
    id: id(n), title, description: '', category: 'tools', brand: null,
    condition: 'good', status: 'active', price: 50,
    created_at: '2026-01-01T00:00:00Z', latitude: 41, longitude: -87,
    pickup_available: true, shipping_available: false, visible: true,
    ...overrides,
  };
  await db.query(`insert into public.listings (${Object.keys(row).join(',')})
    values (${Object.keys(row).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
}

async function search(query, params = {}) {
  const args = { p_query: query, ...params };
  return (await db.query(`select * from public.search_marketplace_listings_v3(
    ${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(',')})`, Object.values(args))).rows;
}
const ids = (rows) => rows.map((row) => row.listing_id);

test('exact, every prefix, case, whitespace, punctuation and English plurals', async () => {
  for (const [n, title] of [[1, 'Toolbox'], [2, 'Compressor'], [3, 'Wrench'], [4, 'Battery']]) {
    await listing(n, title);
    for (let length = 1; length <= title.length; length++) {
      assert.ok(ids(await search(`  ${title.slice(0, length).toUpperCase()}!  `)).includes(id(n)), `${title} prefix ${length}`);
    }
  }
  assert.deepEqual(ids(await search('wrenches')), [id(3)]);
  assert.deepEqual(ids(await search('batteries')), [id(4)]);
  await listing(5, 'Red cordless drill');
  assert.deepEqual(ids(await search('  RED,,,  cordless--DRILL ')), [id(5)]);
});

test('one deletion, insertion, substitution and adjacent transposition across words', async () => {
  await listing(1, 'Toolbox');
  await listing(2, 'Wrench');
  await listing(3, 'Compressor');
  await listing(4, 'Drill');
  for (const [query, expected] of [
    ['tolbox', 1], ['toolbx', 1], ['toolbax', 1], ['tooolbox', 1],
    ['wrenhc', 2], ['wrenc', 2], ['compresor', 3], ['compressro', 3],
    ['dril', 4], ['dirll', 4],
  ]) assert.deepEqual(ids(await search(query)), [id(expected)], query);
});

test('all terms must match, including prefixes/typos spread across existing fields', async () => {
  await listing(1, 'Cordless drill', { brand: 'DeWalt', description: 'Red housing', category: 'equipment' });
  await listing(2, 'Cabinet', { category: 'tool_storage', description: 'Rolling metal cabinet' });
  for (const query of ['dewalt drill', 'dewlat dri', 'red drill', 'equipm red', 'cordless red dewalt']) {
    assert.deepEqual(ids(await search(query)), [id(1)], query);
  }
  for (const query of ['tool storage', 'tool storag', 'rolling cabin', 'storgae metal']) {
    assert.deepEqual(ids(await search(query)), [id(2)], query);
  }
  assert.deepEqual(await search('dewalt cabinet'), []);
  assert.deepEqual(await search('red missing'), []);
});

test('rank exact title, title prefix, title words, category, other fields, then typos', async () => {
  await listing(1, 'Tool', { category: 'equipment', created_at: '2025-01-01' });
  await listing(2, 'Tool chest', { category: 'equipment' });
  await listing(3, 'Red tool', { category: 'equipment' });
  await listing(4, 'Wrench', { category: 'tools' });
  await listing(5, 'Case', { category: 'equipment', description: 'Holds a tool' });
  await listing(6, 'Toll', { category: 'equipment' });
  assert.deepEqual(ids(await search('tool')), [1, 2, 3, 4, 5, 6].map(id));
  await listing(7, 'Toolbox', { category: 'equipment' });
  await listing(8, 'Box', { description: 'Toolbox', category: 'equipment' });
  assert.deepEqual(ids(await search('toolbo')), [id(7), id(8)]);
});

test('reject unrelated, multiple edits, fuzzy short words/numbers, substring-only matches', async () => {
  await listing(1, 'Wrench Toolbox Bolt M18', { category: 'equipment' });
  for (const query of ['banana', 'zzzzzz', 'wraxch', 'tulbax', 'box', 'olt', 'bol', 'M19']) {
    // bol is a genuine prefix; short queries allow literal prefixes, never typos.
    assert.deepEqual(ids(await search(query)), query === 'bol' ? [id(1)] : [], query);
  }
  await listing(2, 'Abcdef', { category: 'equipment' });
  assert.deepEqual(await search('abcedg'), [], 'shared deletion keys are only candidates');
});

test('category, condition, price, radius, fulfillment and visibility apply before pagination', async () => {
  await listing(1, 'Drill');
  await listing(2, 'Drill', { category: 'equipment' });
  await listing(3, 'Drill', { condition: 'new' });
  await listing(4, 'Drill', { price: 300 });
  await listing(5, 'Drill', { latitude: 44 });
  await listing(6, 'Drill', { pickup_available: false, shipping_available: true });
  await listing(7, 'Drill', { status: 'sold' });
  await listing(8, 'Drill', { visible: false });
  await listing(9, 'Drill', { latitude: null, longitude: null });
  await db.exec('set role authenticated');
  const rows = await search('dril', {
    p_category: 'tools', p_condition: 'good', p_min_price: 40, p_max_price: 100,
    p_latitude: 41, p_longitude: -87, p_radius_miles: 10, p_fulfillment: 'pickup',
    p_limit: 2,
  });
  assert.deepEqual(ids(rows), [id(1)]);
  assert.equal(rows[0].distance_miles, 0);
  assert.ok(!ids(await search('dril')).includes(id(7)));
  assert.ok(!ids(await search('dril')).includes(id(8)));
  assert.ok(ids(await search('dril')).includes(id(9)), 'manual locations remain searchable without radius');
  assert.deepEqual(ids(await search('drill', { p_fulfillment: 'shipping' })), [id(6)]);
});

test('fulfillment filtering cannot truncate the page behind fifty ineligible listings', async () => {
  await listing(1, 'Drill');
  for (let n = 2; n <= 56; n++) await listing(n, 'Drill', { pickup_available: false });
  assert.deepEqual(ids(await search('drill', { p_fulfillment: 'pickup', p_limit: 2 })), [id(1)]);
});

test('all sorts paginate stably across score, date, price and distance ties', async () => {
  for (let n = 1; n <= 9; n++) await listing(n, n < 4 ? 'Drill' : 'Red drill', {
    price: n % 3 * 10, latitude: 41 + n % 3 * 0.01,
    created_at: n % 2 ? '2026-01-01' : '2026-02-01',
  });
  for (const sort of ['relevance', 'newest', 'closest', 'price_asc', 'price_desc']) {
    const args = { p_sort: sort, p_latitude: 41, p_longitude: -87 };
    const expected = await search('drill', args);
    const paged = [];
    let cursor = {};
    for (let page = 0; page < 6; page++) {
      const rows = await search('drill', { ...args, ...cursor, p_limit: 2 });
      if (!rows.length) break;
      paged.push(...rows);
      const last = rows.at(-1);
      cursor = {
        p_cursor_id: last.listing_id, p_cursor_created_at: last.cursor_created_at,
        p_cursor_price: last.cursor_price, p_cursor_distance: last.distance_miles,
        p_cursor_score: last.cursor_score,
      };
    }
    assert.equal(expected.length, 9);
    assert.deepEqual(ids(paged), ids(expected), sort);
    const values = sort === 'relevance' ? expected.map((r) => -r.cursor_score)
      : sort === 'closest' ? expected.map((r) => r.distance_miles)
      : sort === 'price_asc' ? expected.map((r) => Number(r.cursor_price))
      : sort === 'price_desc' ? expected.map((r) => -Number(r.cursor_price))
      : expected.map((r) => -new Date(r.cursor_created_at).getTime());
    assert.deepEqual(values, [...values].sort((a, b) => a - b), sort);
  }
});

test('blank/punctuation queries browse newest; null fields and literal operators are safe', async () => {
  await listing(1, 'Drill', { description: null });
  await listing(2, 'Wrench', { created_at: '2026-02-01' });
  for (const query of [null, '', '   ', '! : * | --']) {
    assert.deepEqual(ids(await search(query)), [id(2), id(1)]);
  }
  assert.deepEqual(ids(await search("'drill':*")), [id(1)]);
  assert.deepEqual(await search('drill OR wrench'), [], 'query operators are literal search terms');
});

test('RPC validates inputs and remains authenticated/security-invoker', async () => {
  for (const params of [
    { p_limit: 0 }, { p_limit: 51 }, { p_sort: 'invalid' }, { p_category: 'invalid' },
    { p_condition: 'invalid' }, { p_fulfillment: 'invalid' }, { p_min_price: -1 },
    { p_min_price: 100, p_max_price: 10 }, { p_radius_miles: 10 },
    { p_latitude: 41 }, { p_sort: 'closest' }, { p_cursor_id: id(1) },
  ]) await assert.rejects(() => search('drill', params));
  await assert.rejects(() => search('a'.repeat(513)));
  await db.exec('set role anon');
  await assert.rejects(() => search('drill'), /permission denied/);
  await db.exec('reset role');
  const result = await db.query("select prosecdef from pg_proc where proname = 'search_marketplace_listings_v3'");
  assert.equal(result.rows[0].prosecdef, false);
});

test('prefix and fuzzy candidates use the expression GIN index and update with listing text', async () => {
  await listing(1, 'Compressor');
  await db.exec('set enable_seqscan = off');
  try {
    for (const query of ['compres', 'compresor', 'compressro', 'compressor tools']) {
      const plan = await db.query(`explain (format json) select id from public.listings
        where status = 'active' and public.marketplace_search_document(title, description, category, brand)
        @@ public.marketplace_search_query($1)`, [query]);
      assert.match(JSON.stringify(plan.rows), /listings_active_search_terms_idx/, query);
    }
  } finally { await db.exec('reset enable_seqscan'); }
  await db.query('update public.listings set title = $1 where id = $2', ['Generator', id(1)]);
  assert.deepEqual(await search('compresor'), []);
  assert.deepEqual(ids(await search('generatr')), [id(1)]);
});

test('client keeps server relevance order and forwards its score cursor with local-only filters', () => {
  const ranked = [{ id: 'older', createdAt: '2025-01-01' }, { id: 'newer', createdAt: '2026-01-01' }];
  assert.deepEqual(sortListings(ranked, 'relevance'), ranked);
  const repository = readFileSync('src/features/listings/services/listingRepository.ts', 'utf8');
  assert.match(repository, /'search_marketplace_listings_v3'/);
  assert.match(repository, /p_cursor_score: cursor\?\.score \?\? null/);
  assert.match(repository, /score: last\.cursor_score/);
  assert.match(repository, /p_fulfillment: PUBLIC_SHIPPING_ENABLED \? filters\.fulfillment : 'pickup'/);
  assert.match(repository, /p_limit: SEARCH_PAGE_SIZE \+ 1/);
});

test('existing long descriptions cannot fail writes because of index lexeme limits', async () => {
  await listing(1, 'Drill', { description: 'x'.repeat(5000) });
  await listing(2, 'Wrench', { description: '界'.repeat(2000) });
  assert.deepEqual(ids(await search('drill')), [id(1)]);
  assert.deepEqual(ids(await search('x'.repeat(512))), [id(1)]);
});

test('the RPC candidate query chooses the search index on a larger selective fixture', async () => {
  await listing(1, 'Compressor');
  await db.exec(`insert into public.listings (id, title, description, category, status, price, created_at, pickup_available)
    select md5(n::text)::uuid, 'Garden planter ' || n, 'Terracotta flower container', 'supplies',
      'active', 20, '2026-01-01'::timestamptz, true from generate_series(1, 2000) n;`);
  await db.exec('vacuum analyze public.listings');
  // EXPLAIN the actual RPC SELECT with its bound values (not a simplified index-only query).
  const body = migration.split(/  return query\r?\n/)[1].split(/\r?\nend;/)[0];
  const bindings = {
    v_query: "'compresor'", v_terms: "public.marketplace_search_query('compresor')",
    p_sort: "'relevance'", p_fulfillment: "'pickup'", p_limit: '21',
    p_latitude: 'null::double precision', p_longitude: 'null::double precision',
    p_radius_miles: 'null::double precision', p_category: 'null::text', p_condition: 'null::text',
    p_min_price: 'null::numeric', p_max_price: 'null::numeric',
    p_cursor_id: 'null::uuid', p_cursor_created_at: 'null::timestamptz',
    p_cursor_score: 'null::integer', p_cursor_price: 'null::numeric', p_cursor_distance: 'null::double precision',
  };
  const query = body.replace(/\b(?:v|p)_\w+\b/g, (name) => {
    assert.ok(name in bindings, `Missing binding ${name}`);
    return bindings[name];
  });
  await db.exec('set role authenticated');
  const plan = await db.query(`explain (analyze, format json) ${query}`);
  assert.match(JSON.stringify(plan.rows), /candidate_ids/);
  assert.match(JSON.stringify(plan.rows), /listings_pkey/, 'RLS checks look up candidate IDs instead of scanning inventory');
  // Inspect the definer helper's actual SELECT as its owner. The outer query
  // above still runs as authenticated and rechecks RLS on the candidate IDs.
  await db.exec('reset role');
  const candidateBody = migration.split('as $$').find((part) => part.includes('select l.id from public.listings l'))
    .split('$$;')[0].replace(/\bp_terms\b/g, "public.marketplace_search_query('compresor')");
  const candidatePlan = await db.query(`explain (analyze, format json) ${candidateBody}`);
  assert.match(JSON.stringify(candidatePlan.rows), /listings_active_search_terms_idx/);
  await db.exec('set role authenticated');
  assert.deepEqual(ids(await search('compresor', { p_fulfillment: 'pickup' })), [id(1)]);
});

# Marketplace search

## Root cause and scope

Browse used `search_marketplace_listings_v2`, which wrapped the original
`search_marketplace_listings` RPC. Its English `websearch_to_tsquery` predicate
matched whole/stemmed words, with neither prefix nor typo support. It searched
title, description, category, and brand, but ordered only by date, distance, or
price. Browse then sorted the returned listings again on the client.

The v2 wrapper also applied fulfillment after fetching 50 candidates. Enough
ineligible rows could produce a short page and conceal further eligible results.

The new v3 RPC keeps search in PostgreSQL and returns only one page of IDs,
distance, and cursor values. The repository still hydrates at most 20 listings
and requests 21 matches to detect the next page. No marketplace download or
runtime search service/dependency is introduced.

## Matching and ranking

- Queries and fields are lowercased; punctuation/underscores become spaces;
  whitespace is collapsed. The four existing searchable fields remain the scope.
  Location and condition remain filters rather than keyword fields.
- Every distinct query term must match somewhere in those fields. Operators such
  as `OR` are literal words, not a special query language. Blank or punctuation-only
  queries browse newest. Queries longer than 512 characters are rejected.
- Raw word keys use PostgreSQL [`:*` prefix matching](https://www.postgresql.org/docs/current/textsearch-controls.html), so incomplete words work
  without being treated as typos. English stems preserve inflection/plural matches.
- Typo candidate keys include the original word and each single-character deletion.
  Words one edit apart share a key, including adjacent transpositions. Candidates
  must then pass an actual one-edit check: insertion, deletion, substitution, or
  adjacent swap. Both words must contain only letters and be 4–32 characters long.
  Short tokens and model numbers receive literal/prefix matching, not fuzzy matching.
- Best match is the default sort. Tiers are exact normalized title (600), title
  beginning with the query (500), all terms strongly in title (400–480), all terms
  strongly in title/category (300–380), other strong field matches (200–280), then
  any typo-dependent match (100–180). A missing term excludes the listing.
- Equal scores use newest timestamp, then descending ID. The cursor carries score,
  timestamp, and ID. Explicit Newest, Closest, and price sorts retain their previous
  ordering/cursors. Empty Best match browsing is newest-first. Client sorting keeps
  server order in Best match mode.

## Migration, indexes, and visibility

`supabase/migrations/202609090042_improve_marketplace_search.sql` is required before
the updated client can call v3. It was applied to development project
`YOUR_PROJECT_REF` on September 9, 2026, and its migration record, functions,
schema, and valid index were verified remotely. Older RPCs remain available for
older clients. This does not indicate deployment to any other project.

The migration adds one partial expression GIN index:
`listings_active_search_terms_idx`. It indexes raw word, stem, and deletion keys
from the four fields, only for active listings. This makes both prefixes and typo
candidates indexable without adding listing columns, changing listing write rules,
or introducing an extension. PostgreSQL maintains the index when indexed text or
status changes. Deletion keys increase index size and write work proportionally to
word length, bounded to 32 characters per fuzzy word; duplicate keys are removed.
Raw keys are bounded below PostgreSQL's lexeme byte limit so existing long text
cannot cause index-maintenance errors. Final scoring uses the original text.

PostgreSQL does not push the non-leakproof text-search operator through [RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). A
small `SECURITY DEFINER` helper in `marketplace_search_private` therefore performs
only indexed active-inventory candidate-ID lookup. This schema is internal and
must stay outside PostgREST's exposed schemas. PUBLIC/anon cannot execute the
helper. Authenticated SQL can call it; it returns only active candidate IDs, which
the existing listing policies already allow authenticated users to read.

The public RPC remains authenticated-only and **SECURITY INVOKER**. It joins every
candidate back to `listings` under caller RLS, then applies status, category,
condition, prices, location/radius, and fulfillment before ranking and paging.
It does not return candidate IDs that caller RLS hides. Empty browsing uses a
separate query branch; selective searches use candidate primary-key lookups.
Per-call custom planning avoids a cached generic plan across very different filters.
No listing policies or authentication flows change.

Index construction uses ordinary transactional CREATE INDEX and needs the normal
index-build lock; it is not a concurrent online build. Production-sized index build
time, size, and query latency have not been measured. Broad prefixes naturally
have more candidates. Normal PostgreSQL GIN/autovacuum maintenance remains needed.

## Validation

`@electric-sql/pglite` is a development-only dependency. The regression suite runs
the actual migration/functions in embedded PostgreSQL, with a minimal listings
fixture and non-owner RLS role. It does not connect to Supabase.

```sh
node --test scripts/tests/marketplace-search.test.mjs
node --test scripts/tests/*.test.mjs
npx --yes deno test --no-lock --node-modules-dir=none scripts/tests/payout-recovery.test.ts scripts/tests/processing-fee-recovery.test.ts scripts/tests/refund-recovery.test.ts
npx tsc --noEmit
npm run lint
git diff --check
```

Coverage includes multiple words and every prefix, normalization, all four typo
types, plurals, all four fields, multi-term requirements, rank tiers, negative
matches, all filters, missing coordinates, inactive/RLS-hidden rows, authenticated
access, every sort's cursor traversal, the former 50-row fulfillment cutoff, and
long existing text. A 2,001-row fixture checks the actual candidate query's GIN
plan and authenticated outer query's primary-key lookups after VACUUM ANALYZE.
These are local correctness/planner checks, not a production load benchmark.

Validation on September 9, 2026: 14 focused search tests passed; the full Node
suite passed 208 tests; the three Deno files passed 9 tests. TypeScript, Expo
ESLint, and `git diff --check` passed. The repository's required
[Expo v55 reference](https://docs.expo.dev/versions/v55.0.0/) was reviewed before
editing; Expo versions and APIs were not changed.

Files changed for this task: this document; the migration and regression test;
`package.json` and `package-lock.json`; `src/features/browse/BrowseScreen.tsx`,
`listingSort.ts`, `store/BrowseStore.tsx`, and `types/search.ts`;
`src/features/listings/services/listingRepository.ts` (search function only).

Payment, shipping transaction behavior, account deletion, authentication, listing
creation rules, prohibited-item policy, favorites, and transaction logic are
unchanged by this task. Existing unrelated working-tree edits are preserved.

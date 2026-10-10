import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const details = readFileSync(new URL('../../src/features/listings/ProductDetailsScreen.tsx', import.meta.url), 'utf8');

test('listing age copy does not append a duplicate ago suffix', () => {
  assert.match(details, /Listed \{listing\.timeAgo\}</);
  assert.doesNotMatch(details, /Listed \{listing\.timeAgo\} ago/);
});

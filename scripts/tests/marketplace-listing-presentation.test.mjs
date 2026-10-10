import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { sortListings } from '../../src/features/browse/listingSort.ts';
import {
  calculateDistanceMiles,
  formatDistanceMiles,
} from '../../src/features/location/formatDistance.ts';

const listing = (id, price, createdAt, distanceMiles) => ({ id, price, createdAt, distanceMiles });

test('Browse listing sorts use real timestamp, distance, and numeric price values', () => {
  const listings = [
    listing('older-near', 20, '2026-01-01T00:00:00Z', 2),
    listing('newer-far', 100, '2026-02-01T00:00:00Z', 20),
    listing('middle-unknown', 50, '2026-01-15T00:00:00Z', null),
  ];

  assert.deepEqual(sortListings(listings, 'newest').map(({ id }) => id), [
    'newer-far', 'middle-unknown', 'older-near',
  ]);
  assert.deepEqual(sortListings(listings, 'closest').map(({ id }) => id), [
    'older-near', 'newer-far', 'middle-unknown',
  ]);
  assert.deepEqual(sortListings(listings, 'price_asc').map(({ id }) => id), [
    'older-near', 'middle-unknown', 'newer-far',
  ]);
  assert.deepEqual(sortListings(listings, 'price_desc').map(({ id }) => id), [
    'newer-far', 'middle-unknown', 'older-near',
  ]);
});

test('distance calculation requires valid coordinates and never formats missing data as zero', () => {
  const chicago = { latitude: 41.8781, longitude: -87.6298 };
  const milwaukee = { latitude: 43.0389, longitude: -87.9065 };
  const distance = calculateDistanceMiles(chicago, milwaukee);

  assert.ok(distance != null && distance > 80 && distance < 100);
  assert.equal(calculateDistanceMiles(chicago, { latitude: null, longitude: null }), null);
  assert.equal(formatDistanceMiles(null), null);
  assert.equal(formatDistanceMiles(Number.NaN), null);
  assert.equal(formatDistanceMiles(0), '<0.1 mi away');
});

test('Saved Items uses distance controls and shared cards retain cover thumbnails', () => {
  const saved = readFileSync('src/features/profile/SavedItemsScreen.tsx', 'utf8');
  const card = readFileSync('src/components/ListingCard.tsx', 'utf8');
  const details = readFileSync('src/features/listings/ProductDetailsScreen.tsx', 'utf8');

  for (const label of ['Any distance', 'Within 5 mi', 'Within 10 mi', 'Within 25 mi', 'Within 50 mi']) {
    assert.match(saved, new RegExp(label));
  }
  assert.doesNotMatch(saved, /\['All', 'Local', 'Ships'\]/);
  assert.match(saved, /calculateDistanceMiles\(coordinates, item\.listing\)/);
  assert.match(card, /contentFit="cover"/);
  assert.match(details, /galleryImage[\s\S]*contentFit="contain"|contentFit="contain"[\s\S]*galleryImage/);
});

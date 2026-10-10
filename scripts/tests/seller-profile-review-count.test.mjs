import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repository = readFileSync('src/features/sellers/services/sellerRepository.ts', 'utf8');
const screen = readFileSync('src/features/sellers/SellerProfileScreen.tsx', 'utf8');

test('seller profile derives review metrics from the Reviews screen data source', () => {
  assert.match(repository, /import \{ fetchProfileReviews \} from '@\/features\/reviews\/reviewRepository'/);
  assert.match(repository, /fetchProfileReviews\(sellerId\)/);
  assert.match(repository, /totalReviews: reviews\.length/);
  assert.match(repository, /reviews\.reduce\(\(sum, review\) => sum \+ review\.rating, 0\) \/ reviews\.length/);
  assert.match(repository, /verifiedSalesCount: Number\(row\.verified_sales_count\)/);
});

test('seller profile formats singular and plural review counts', () => {
  assert.match(screen, /formatReviewCount\(profile\.totalReviews\)/);
  assert.match(screen, /count === 1 \? 'review' : 'reviews'/);
});

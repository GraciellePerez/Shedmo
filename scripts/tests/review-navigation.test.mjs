import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = p => readFileSync(p, 'utf8');
test('own profile rating and review statistic open the viewed profile reviews', () => {
  const source = read('src/features/profile/ProfileScreen.tsx');
  assert.match(source, /pathname: '\/reviews\/\[sellerId\]', params: \{ sellerId: profile.id \}/);
  assert.match(source, /onReviewsPress=\{openReviews\}/);
  assert.match(source, /<Stat label="Reviews"[^>]*onPress=\{openReviews\}/);
  const hero = read('src/features/profile/components/ProfileHero.tsx');
  assert.match(hero, /onPress=\{onReviewsPress\}/);
  assert.doesNotMatch(hero, /disabled=\{[^}]*reviews/);
});
test('seller visitor route uses the viewed seller and existing moderated review repository', () => {
  assert.match(read('src/features/sellers/SellerProfileScreen.tsx'), /pathname: '\/reviews\/\[sellerId\]', params: \{ sellerId \}/);
  assert.match(read('src/features/account/ReviewsScreen.tsx'), /fetchProfileReviews\(sellerId\)/);
  assert.match(read('src/features/reviews/reviewRepository.ts'), /rpc\('get_profile_reviews'/);
  assert.match(read('src/features/account/ReviewsScreen.tsx'), /No reviews yet/);
});

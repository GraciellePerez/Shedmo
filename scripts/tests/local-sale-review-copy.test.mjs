import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync('src/features/localSales/LocalSaleReviewScreen.tsx', 'utf8');

test('post-transaction review uses concise public V1 copy', () => {
  assert.match(screen, /title="Leave a Review"/);
  assert.match(screen, /How was your transaction\?/);
  assert.match(screen, /'Review submitted','Thanks for sharing your experience\.'/);
  assert.match(screen, /text:'Done'/);
  assert.doesNotMatch(screen, /Confirmed Local Sale Review|local transaction|process or verify payment|Shedmo-processed payment/);
});

test('review eligibility and authorization calls remain intact', () => {
  assert.match(screen, /get_local_sale_review_status_v1/);
  assert.match(screen, /submit_local_sale_review_v1/);
  assert.match(screen, /Only mutually confirmed local sales may be reviewed once per person\./);
});

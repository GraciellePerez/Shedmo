import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync('src/features/checkout/OrderConfirmationScreen.tsx', 'utf8');

test('confirmation describes the implemented fulfillment workflows', () => {
  assert.doesNotMatch(screen, /added in a later phase/i);
  assert.match(screen, /QR code and backup PIN/i);
  assert.match(screen, /carrier and tracking details/i);
});

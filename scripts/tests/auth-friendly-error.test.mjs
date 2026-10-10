import assert from 'node:assert/strict';
import test from 'node:test';

import { friendlyError } from '../../src/features/auth/authErrors.ts';

test('signup rate limits receive an actionable message', () => {
  const expected = 'Too many account requests were made recently. Please wait a few minutes and try again.';
  assert.equal(friendlyError('Email rate limit exceeded'), expected);
  assert.equal(friendlyError('429 Too Many Requests'), expected);
});

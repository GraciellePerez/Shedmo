import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { passwordUpdateError } from '../../src/features/auth/authErrors.ts';

const store = readFileSync('src/features/auth/store/AuthStore.tsx', 'utf8');
const screen = readFileSync('src/features/auth/ResetPasswordScreen.tsx', 'utf8');

test('same-password Auth errors receive the specific user-facing message', () => {
  const expected = 'Your new password must be different from your current password.';
  assert.equal(passwordUpdateError({ code: 'same_password', message: 'unrelated wording' }), expected);
  assert.equal(passwordUpdateError({ message: 'New password should be different from the old password.' }), expected);
  assert.match(store, /auth\.updateUser\(\{ password \}\)/);
  assert.match(screen, /Alert\.alert\('Password not changed', result\.error\)/);
});

test('unrelated password errors retain existing specific and generic handling', () => {
  assert.equal(passwordUpdateError({ message: 'network request failed' }), 'Unable to reach Supabase. Check your connection and try again.');
  assert.equal(passwordUpdateError({ message: 'unexpected auth response' }), 'The request could not be completed. Please try again.');
  assert.match(store, /success: 'Your password has been updated\.'/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { accountDeletionError } from '../../src/features/auth/accountDeletionError.ts';

const edge = readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
const cleanup = readFileSync('supabase/migrations/202610050054_atomic_account_deletion.sql', 'utf8');
const settings = readFileSync('src/features/account/SettingsScreen.tsx', 'utf8');
const screen = readFileSync('src/features/account/DeleteAccountScreen.tsx', 'utf8');
const auth = readFileSync('src/features/auth/store/AuthStore.tsx', 'utf8');
const signup = readFileSync('src/features/auth/SignUpScreen.tsx', 'utf8');
const detail = readFileSync('src/features/account/SettingDetailScreen.tsx', 'utf8');
const app = JSON.parse(readFileSync('app.json', 'utf8'));

test('account deletion is accessible and requires explicit confirmation', () => {
  assert.match(settings, /Delete Account[\s\S]*\/settings\/delete-account/);
  assert.match(screen, /Type DELETE to continue/);
  assert.match(screen, /This cannot be undone/);
  assert.match(auth, /functions\.invoke\('delete-account'/);
  assert.match(edge, /body\?\.confirmation !== "DELETE"/);
});

test('trusted server derives identity and refuses unresolved transactions', () => {
  assert.match(edge, /requireAuthenticatedUser\(request, admin\)/);
  assert.doesNotMatch(edge, /sellerId|userId/);
  assert.match(edge, /pending_buyer_confirmation/);
  assert.match(edge, /Resolve active transactions before deleting your account/);
  assert.match(edge, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(edge, /\.eq\("buyer_id", user\.id\)\.or\(unresolvedOrder\)/);
  assert.match(edge, /\.eq\("seller_id", user\.id\)\.or\(unresolvedOrder\)/);
  assert.doesNotMatch(edge, /orders[\s\S]{0,200}\.limit\(100\)/);
});

test('service-role storage removal rejects metadata outside the verified user prefix', () => {
  assert.match(edge, /const storagePrefix = `\$\{user\.id\}\//);
  assert.match(edge, /path\.startsWith\(storagePrefix\)/);
  assert.match(edge, /throw new Error\("UNSAFE_STORAGE_PATH"\)/);
  assert.ok(edge.indexOf('UNSAFE_STORAGE_PATH') < edge.indexOf('.remove(imagePaths.slice'));
  assert.match(edge, /listStoredFiles\(admin, user\.id\)/);
});

test('private data and storage are cleaned while retained records are anonymized', () => {
  for (const value of ['listing-images', 'profile-avatars', 'favorites', 'notifications', 'push_tokens', 'conversation_reads']) {
    assert.match(edge + cleanup, new RegExp(value.replace('-', '[-]')));
  }
  assert.match(cleanup, /Message removed after account deletion/);
  assert.match(cleanup, /Deleted member/);
  assert.match(edge, /deleteUser\(user\.id, true\)/);
  assert.match(cleanup, /marketplace_reviews/);
  assert.match(cleanup, /after update of deleted_at on auth.users/);
  assert.doesNotMatch(edge, /from\("profiles"\)\.update/);
  assert.doesNotMatch(edge, /auth\.admin\.signOut/);
  assert.ok(edge.indexOf('failIfError((await admin.auth.admin.deleteUser') < edge.indexOf('return json({ deleted: true })'));
});

test('client distinguishes active transactions, generic failures, throws, and success', () => {
  assert.equal(
    accountDeletionError({ context: { status: 409 } }),
    'Your account cannot be deleted until unresolved marketplace activity is completed or canceled.',
  );
  assert.equal(
    accountDeletionError({ context: { status: 404 } }),
    'Account deletion is temporarily unavailable. Please try again later.',
  );
  assert.equal(
    accountDeletionError(new Error('Network unavailable')),
    'Account deletion could not be completed. Please try again.',
  );
  assert.doesNotMatch(readFileSync('src/features/auth/accountDeletionError.ts', 'utf8'), /instanceof Response/);
  assert.match(auth, /accountDeletionError\(error\)/);
  assert.match(auth, /data\?\.deleted !== true/);
  assert.match(auth, /try \{[\s\S]*functions\.invoke\('delete-account'[\s\S]*\} catch \{/);
  assert.match(auth, /setSession\(null\)[\s\S]*return \{ success: 'Your account was deleted\.' \}/);
  assert.match(screen, /catch \{[\s\S]*Account not deleted[\s\S]*finally \{[\s\S]*setDeleting\(false\)/);
});

test('public account copy and iOS camera purpose match local marketplace V1', () => {
  assert.doesNotMatch(detail.match(/account:.*$/m)?.[0] ?? '', /private.?beta|prototype|development|test mode|coming later/i);
  assert.doesNotMatch(signup, /private.?beta|prototype|development|test mode|coming later/i);
  assert.match(signup, /Create your local marketplace profile/);
  const plugins = app.expo.plugins;
  const imagePicker = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-image-picker');
  const camera = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera');
  assert.equal(imagePicker[1].photosPermission, 'Allow Shedmo to select photos for chat messages, profile pictures, listings, and dispute evidence.');
  assert.equal(imagePicker[1].cameraPermission, 'Allow Shedmo to take photos for marketplace listings.');
  assert.equal(camera[1].cameraPermission, 'Allow Shedmo to take photos for marketplace listings.');
});

test('legal pages use the approved canonical document screen', () => {
  assert.match(detail, /if \(isLegalSlug\(slug\)\) return <LegalDocumentScreen/);
  assert.doesNotMatch(detail, /terms:.*Draft|'privacy-policy':.*Draft|'prohibited-items':.*Draft/);
});

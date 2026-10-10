import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootLayout = readFileSync(new URL('../../src/app/_layout.tsx', import.meta.url), 'utf8');

test('splash dismissal depends on local font readiness, not auth restoration', () => {
  assert.match(rootLayout, /if \(fontsReady\) void SplashScreen\.hideAsync\(\)/);
  assert.doesNotMatch(rootLayout, /fontsReady\s*&&\s*!initializing/);
});

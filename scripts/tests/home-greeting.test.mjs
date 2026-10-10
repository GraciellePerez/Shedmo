import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getLocalTimeGreeting } from '../../src/features/home/homeGreeting.ts';

const atLocalHour = (hour) => new Date(2026, 0, 1, hour, 0, 0);
const home = readFileSync('src/features/home/HomeScreen.tsx', 'utf8');

test('home greeting follows device-local time boundaries', () => {
  assert.equal(getLocalTimeGreeting(atLocalHour(4)), 'Good evening');
  assert.equal(getLocalTimeGreeting(atLocalHour(5)), 'Good morning');
  assert.equal(getLocalTimeGreeting(atLocalHour(11)), 'Good morning');
  assert.equal(getLocalTimeGreeting(atLocalHour(12)), 'Good afternoon');
  assert.equal(getLocalTimeGreeting(atLocalHour(16)), 'Good afternoon');
  assert.equal(getLocalTimeGreeting(atLocalHour(17)), 'Good evening');
  assert.equal(getLocalTimeGreeting(atLocalHour(23)), 'Good evening');
});

test('home header shows only the local-time greeting and preserves Shedmo', () => {
  assert.match(
    home,
    /<Text style=\{styles\.greeting\}>\{getLocalTimeGreeting\(\)\}<\/Text>\s*<Text style=\{styles\.brand\}>Shedmo<\/Text>/,
  );
  assert.doesNotMatch(home, /<Text style=\{styles\.greeting\}>\{profile\.displayName\}<\/Text>/);
  assert.doesNotMatch(home, />Good morning<\/Text>/);
});

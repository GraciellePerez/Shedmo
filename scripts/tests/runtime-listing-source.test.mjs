import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const storePath = new URL('../../src/features/listings/store/ListingStore.tsx', import.meta.url);
const homePath = new URL('../../src/features/home/HomeScreen.tsx', import.meta.url);

test('runtime listing store never substitutes seed inventory', async () => {
  const source = await readFile(storePath, 'utf8');

  assert.doesNotMatch(source, /seedListings|mock-fallback|development sample data/);
  assert.match(source, /const listings = useMemo\(\(\) => remoteListings\.filter/);
  assert.match(source, /setRemoteListings\(\[\]\);[\s\S]*setHasMore\(false\);[\s\S]*Real listings could not be loaded/);
});

test('home reports truthful empty and failed listing states with retry', async () => {
  const source = await readFile(homePath, 'utf8');

  assert.match(source, /No active listings yet/);
  assert.match(source, /Couldn't load listings/);
  assert.match(source, />Retry</);
  assert.match(source, /onPress=\{\(\) => void refresh\(\)\}/);
  assert.doesNotMatch(source, /mock-fallback|development sample data/);
});

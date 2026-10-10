import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sellPath = new URL('../../src/features/sell/SellScreen.tsx', import.meta.url);
const repositoryPath = new URL('../../src/features/listings/services/listingRepository.ts', import.meta.url);

test('validated manual city and state can publish when device geocoding is unavailable', async () => {
  const [screen, repository] = await Promise.all([
    readFile(sellPath, 'utf8'),
    readFile(repositoryPath, 'utf8'),
  ]);

  assert.doesNotMatch(screen, /Verify the city, state, and ZIP code before publishing/);
  assert.doesNotMatch(screen, /status === 'active'[\s\S]{0,300}useManualLocation/);
  assert.match(screen, /publishDraft\(form\.draft, status/);
  assert.match(repository, /if \(status === 'active' && !hasCoordinates && !hasCityState\)/);
  assert.match(repository, /validateManualLocation\(draft\.city, draft\.state, draft\.postalCode\)/);
});

test('listing preview does not claim reachable marketplace domains are mocked', async () => {
  const screen = await readFile(sellPath, 'utf8');

  assert.doesNotMatch(screen, /Other marketplace domains remain mocked/);
  assert.doesNotMatch(screen, /development marketplace/);
  assert.match(screen, /visible in the marketplace/);
});

test('photo picker uses the installed non-deprecated Expo media type API', async () => {
  const screen = await readFile(sellPath, 'utf8');

  assert.doesNotMatch(screen, /MediaTypeOptions/);
  assert.match(screen, /mediaTypes: \['images'\]/);
});

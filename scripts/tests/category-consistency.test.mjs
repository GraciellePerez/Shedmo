import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const categories = read('src/features/listings/categoryLabels.ts');
const homeCategories = read('src/data/categories.ts');
const sellDraft = read('src/features/sell/types/listingDraft.ts');
const browseFilters = read('src/features/browse/components/BrowseFilterModal.tsx');
const repository = read('src/features/listings/services/listingRepository.ts');

const canonicalCategories = [
  ['tools', 'Tools'],
  ['auto_parts', 'Auto Parts'],
  ['tool_storage', 'Tool Storage'],
  ['equipment', 'Equipment'],
  ['marine', 'Marine'],
  ['outdoor_power', 'Outdoor Power'],
  ['shop_equipment', 'Shop Equipment'],
  ['supplies', 'Supplies'],
];

test('public V1 defines every stored category and label in one canonical source', () => {
  for (const [value, label] of canonicalCategories) {
    assert.match(categories, new RegExp(`label: '${label}', value: '${value}'`));
  }
  assert.equal((categories.match(/\{ label: '.+?', value: '.+?' \}/g) ?? []).length, 8);
});

test('Home, Browse, Sell, and listing persistence reuse canonical category mappings', () => {
  assert.match(homeCategories, /LISTING_CATEGORY_OPTIONS\.map/);
  assert.match(sellDraft, /LISTING_CATEGORIES\.map/);
  assert.match(browseFilters, /LISTING_CATEGORY_OPTIONS\.map/);
  assert.match(repository, /category: LISTING_CATEGORY_BY_LABEL\[draft\.category\]/);
  assert.doesNotMatch(homeCategories, /id: '(auto|storage|outdoor|shop)'/);
});

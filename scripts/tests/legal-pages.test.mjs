import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { LEGAL_EFFECTIVE_DATE, isLegalPath, isLegalSlug, legalDocuments } from '../../src/features/legal/legalDocuments.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

// Digests of the approved attachment, excluding only its implementation notes.
const approved = {
  'privacy-policy': [17, '699ffcdf28d14d6c1b52db5ba0067107c15a7da2cfd34b24384620505ac95c23'],
  terms: [23, '992cdc4dcdcc713ef55580d6a433d1fd3460a70e8fe0b3ef0b4669bbde4dea71'],
  'prohibited-items': [17, 'cb6a769d34ca4e1f56b9de01b750e96ca12b580c0932ca1f535d0cbcb05b11b7'],
};

test('all approved legal text and section order remain intact', () => {
  assert.equal(LEGAL_EFFECTIVE_DATE, 'September 28, 2026');
  for (const [slug, [count, digest]] of Object.entries(approved)) {
    const { title, body } = legalDocuments[slug];
    const text = `${title}\n\nEffective Date: ${LEGAL_EFFECTIVE_DATE}\n\n${body}`;
    assert.equal(createHash('sha256').update(text).digest('hex'), digest, slug);
    assert.deepEqual([...body.matchAll(/^(\d+)\. /gm)].map(m => Number(m[1])), Array.from({ length: count }, (_, i) => i + 1));
    assert.ok(body.includes('shedmoapp@gmail.com'));
    assert.doesNotMatch(body, /IMPORTANT:|Do not invent|Do not implement|Do not claim/);
  }
});

test('public legal navigation accepts exactly the three canonical paths', () => {
  for (const slug of Object.keys(approved)) {
    assert.equal(isLegalSlug(slug), true);
    assert.equal(isLegalPath(`/settings/${slug}`), true);
  }
  for (const slug of ['delete-account', 'payouts', 'account', 'privacy', '__proto__', 'constructor', '']) {
    assert.equal(isLegalSlug(slug), false);
    assert.equal(isLegalPath(`/settings/${slug}`), false);
  }
  for (const path of ['/settings', '/settings/terms/extra', '/conversations/123', '/(tabs)']) {
    assert.equal(isLegalPath(path), false);
  }
});

test('onboarding and Settings keep the same legal destinations and renderer', () => {
  const onboarding = read('src/features/auth/OnboardingScreen.tsx');
  const settings = read('src/features/account/SettingsScreen.tsx');
  for (const slug of ['terms', 'privacy-policy']) {
    assert.ok(onboarding.includes(`href={{ pathname: '/settings/[slug]', params: { slug: '${slug}' } }}`));
  }
  for (const slug of Object.keys(approved)) assert.ok(settings.includes(`slug: '${slug}'`));
  assert.match(read('src/features/account/SettingDetailScreen.tsx'), /if \(isLegalSlug\(slug\)\) return <LegalDocumentScreen/);
  assert.match(read('src/app/_layout.tsx'), /rootSegment !== '\(auth\)' && !isLegalPath\(pathname\) && !passwordRecoveryActive/);
  assert.match(read('src/app/settings/[slug].tsx'), /<SettingDetailScreen slug=\{slug\}/);
});

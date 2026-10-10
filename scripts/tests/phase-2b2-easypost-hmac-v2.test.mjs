import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EASYPOST_HMAC_PREFIX,
  verifyEasyPostWebhookSignatureV2,
} from '../../supabase/functions/_shared/easypost.ts';

const secret = 'development-test-secret-not-a-real-credential';
const timestamp = 'Thu, 20 Aug 2026 12:00:00 +0000';
const nowMs = Date.parse('2026-08-20T12:00:30.000Z');
const method = 'POST';
const path = '/functions/v1/easypost-webhook';
const rawBody = '{"description":"tracker.updated","result":{"id":"trk_test123"}}';

const sign = async ({
  body = rawBody,
  signedMethod = method,
  signedPath = path,
  signedTimestamp = timestamp,
} = {}) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret.normalize('NFKD')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${signedTimestamp}${signedMethod}${signedPath}${body}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `${EASYPOST_HMAC_PREFIX}${hex}`;
};

const validInput = async () => ({
  rawBody,
  signatureHeader: await sign(),
  timestampHeader: timestamp,
  pathHeader: path,
  requestMethod: method,
  requestPath: path,
  webhookSecret: secret,
  nowMs,
});

test('accepts a valid EasyPost HMAC-v2 signature over exact timestamp, method, path, and raw body', async () => {
  assert.equal(await verifyEasyPostWebhookSignatureV2(await validInput()), true);
});

test('rejects each missing EasyPost HMAC-v2 header', async () => {
  const input = await validInput();
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, signatureHeader: null }), false);
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, timestampHeader: null }), false);
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, pathHeader: null }), false);
});

test('rejects malformed or invalid signatures and any signed-content change', async () => {
  const input = await validInput();
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, signatureHeader: 'invalid' }), false);
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, rawBody: `${rawBody} ` }), false);
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, requestMethod: 'PUT' }), false);
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, requestPath: `${path}/other` }), false);
});

test('rejects expired, malformed, and too-far-future timestamps', async () => {
  const input = await validInput();
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, nowMs: nowMs + 31_000 }), false);
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, timestampHeader: '2026-08-20T12:00:00Z' }), false);
  assert.equal(await verifyEasyPostWebhookSignatureV2({ ...input, nowMs: nowMs - 61_000 }), false);
});

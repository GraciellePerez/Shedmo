import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('supabase/functions/admin-operations/reportInspection.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { exports: module.exports, module });
const inspectReport = module.exports.inspectReport;

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
function fixture(data, error = null, imageError = null) {
  const calls = [];
  const images = [];
  return {
    calls,
    images,
    client: {
      rpc: async (name, args) => { calls.push({ name, args }); return { data, error }; },
      storage: { from: bucket => ({ createSignedUrl: async (path, seconds) => {
        images.push({ bucket, path, seconds });
        return { data: { signedUrl: 'https://example.invalid/signed' }, error: imageError };
      } }) },
    },
  };
}

test('staff image inspection signs only the exact reported message path for 60 seconds', async () => {
  const message = id(1), sender = id(2), conversation = id(3);
  const f = fixture({ type: 'message', content: {
    id: message, sender_id: sender, conversation_id: conversation,
    attachment_path: `${conversation}/${sender}/${message}.jpg`,
    attachment_mime_type: 'image/jpeg',
  } });
  const result = await inspectReport(f.client, sender, id(4));
  assert.equal(f.calls[0].name, 'staff_inspect_report_v1');
  assert.deepEqual(f.images, [{
    bucket: 'chat-images',
    path: `${conversation}/${sender}/${message}.jpg`,
    seconds: 60,
  }]);
  assert.equal(result.images.length, 1);
});

test('foreign, malformed, or non-JPEG image paths are never signed', async () => {
  const message = id(1), sender = id(2), conversation = id(3);
  for (const content of [
    { id: message, sender_id: sender, conversation_id: conversation, attachment_path: `${sender}/${conversation}/${message}.jpg`, attachment_mime_type: 'image/jpeg' },
    { id: message, sender_id: sender, conversation_id: conversation, attachment_path: `${conversation}/${sender}/../${message}.jpg`, attachment_mime_type: 'image/jpeg' },
    { id: message, sender_id: sender, conversation_id: conversation, attachment_path: `${conversation}/${sender}/${message}.png`, attachment_mime_type: 'image/png' },
  ]) {
    const f = fixture({ type: 'message', content });
    await assert.rejects(inspectReport(f.client, sender, id(4)));
    assert.equal(f.images.length, 0);
  }
});

test('staff authorization failure cannot trigger any storage signing request', async () => {
  const f = fixture(null, { code: '42501' });
  await assert.rejects(inspectReport(f.client, id(2), id(4)));
  assert.equal(f.images.length, 0);
});

test('chat photo signing failures preserve the report and return a staff warning', async () => {
  const message = id(1), sender = id(2), conversation = id(3);
  const f = fixture({ type: 'message', content: {
    id: message, sender_id: sender, conversation_id: conversation,
    attachment_path: `${conversation}/${sender}/${message}.jpg`,
    attachment_mime_type: 'image/jpeg',
  } }, null, { code: 'not_found' });
  const result = await inspectReport(f.client, sender, id(4));
  assert.equal(result.images.length, 0);
  assert.equal(result.imageWarnings.length, 1);
});

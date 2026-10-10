import { inspectReport } from './reportInspection.ts';

const seller = '00000000-0000-0000-0000-000000000002';
const listing = '00000000-0000-0000-0000-000000000001';
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
async function rejects(action: () => Promise<unknown>) {
  let failed = false;
  try { await action(); } catch { failed = true; }
  assert(failed, 'Expected rejection');
}
function fixture(data: unknown, error: unknown = null, imageError: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const images: { bucket: string; path: string; seconds: number }[] = [];
  return {
    calls, images,
    client: {
      rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data, error }; },
      storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string, seconds: number) => {
        images.push({ bucket, path, seconds }); return { data: { signedUrl: 'https://example.invalid/staff-photo' }, error: imageError };
      } }) },
    },
  };
}

Deno.test('inspection uses report-scoped RPC with verified staff actor, then signs only target photos for 60 seconds', async () => {
  const f = fixture({ type: 'listing', content: { id: listing, seller_id: seller, images: [{ path: `${seller}/${listing}/photo.jpg` }] } });
  const result = await inspectReport(f.client, seller, listing);
  assert(f.calls[0].name === 'staff_inspect_report_v1');
  assert(f.calls[0].args.p_staff_id === seller && f.calls[0].args.p_report_id === listing);
  assert(f.images.length === 1 && f.images[0].bucket === 'listing-images' && f.images[0].seconds === 60);
  assert(result.images.length === 1);
});
Deno.test('RPC authorization failure never requests a storage URL', async () => {
  const f = fixture(null, { code: '42501' });
  await rejects(() => inspectReport(f.client, seller, listing));
  assert(f.images.length === 0);
});
Deno.test('foreign paths, traversal and encoded filenames cannot cause arbitrary signing', async () => {
  for (const path of ['another/owner/photo.jpg', `${seller}/${listing}/../secret`, `${seller}/${listing}/..`, `${seller}/${listing}/%2e%2e`]) {
    const f = fixture({ type: 'listing', content: { id: listing, seller_id: seller, images: [{ path }] } });
    await rejects(() => inspectReport(f.client, seller, listing));
    assert(f.images.length === 0);
  }
});
Deno.test('profile inspection never fetches a user-supplied external avatar URL', async () => {
  const f = fixture({ type: 'seller', content: { id: seller, avatar_url: 'https://untrusted.invalid/private' } });
  await inspectReport(f.client, seller, listing);
  assert(f.images[0].bucket === 'profile-avatars' && f.images[0].path === `${seller}/avatar.jpg`);
});
Deno.test('image-signing failures show warnings without blocking text inspection', async () => {
  const f = fixture({ type: 'listing', content: { id: listing, seller_id: seller, images: [{ path: `${seller}/${listing}/photo.jpg` }] } }, null, { code: 'not_found' });
  const result = await inspectReport(f.client, seller, listing);
  assert(result.images.length === 0 && result.imageWarnings.length === 1);
});
Deno.test('message inspection signs only the canonical private chat image path', async () => {
  const f = fixture({ type: 'message', content: {
    id: listing, sender_id: seller, conversation_id: listing,
    attachment_path: `${listing}/${seller}/${listing}.jpg`, attachment_mime_type: 'image/jpeg',
  } });
  const result = await inspectReport(f.client, seller, listing);
  assert(f.images.length === 1 && f.images[0].bucket === 'chat-images' && f.images[0].seconds === 60);
  assert(result.images[0].label === 'Reported chat photo');
});
Deno.test('message inspection rejects foreign chat image paths without signing them', async () => {
  const f = fixture({ type: 'message', content: {
    id: listing, sender_id: seller, conversation_id: listing,
    attachment_path: `${seller}/${listing}/${listing}.jpg`, attachment_mime_type: 'image/jpeg',
  } });
  await rejects(() => inspectReport(f.client, seller, listing));
  assert(f.images.length === 0);
});
Deno.test('text-only message inspection makes no storage calls', async () => {
  const f = fixture({ type: 'message', content: { id: listing, body: 'Reported text' } });
  const result = await inspectReport(f.client, seller, listing);
  assert(f.images.length === 0 && result.images.length === 0);
});

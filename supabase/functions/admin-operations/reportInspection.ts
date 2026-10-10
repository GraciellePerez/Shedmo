// This helper is called only after admin-operations verifies the JWT and staff role.
// The RPC independently authorizes staff and restricts reads to one report target.
interface InspectorClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  storage: { from(bucket: string): {
    createSignedUrl(path: string, seconds: number): PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
  } };
}

export async function inspectReport(client: InspectorClient, staffId: string, reportId: string) {
  const { data, error } = await client.rpc('staff_inspect_report_v1', { p_staff_id: staffId, p_report_id: reportId });
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Report unavailable');
  const result = data as Record<string, unknown>;
  const content = result.content as Record<string, unknown> | null;
  const images: { url: string; label: string }[] = [];
  const imageWarnings: string[] = [];
  if (content && result.type === 'listing' && Array.isArray(content.images)) {
    for (const item of content.images) {
      const path = typeof item?.path === 'string' ? item.path : '';
      const prefix = `${content.seller_id}/${content.id}/`;
      if (!path.startsWith(prefix) || !/^[A-Za-z0-9_.-]+$/.test(path.slice(prefix.length))
        || ['.', '..'].includes(path.slice(prefix.length))) throw new Error('Invalid report image');
      const signed = await client.storage.from('listing-images').createSignedUrl(path, 60);
      if (signed.error || !signed.data) {
        imageWarnings.push('A reported listing photo could not be loaded. Refresh or escalate storage inspection.');
        continue;
      }
      images.push({ url: signed.data.signedUrl, label: `Listing photo ${images.length + 1}` });
    }
  }
  if (content && result.type === 'seller' && content.avatar_url) {
    // Do not fetch or render a user-supplied external URL in the staff inspection UI.
    if (!/^[0-9a-f-]{36}$/i.test(String(content.id))) throw new Error('Invalid profile');
    const signed = await client.storage.from('profile-avatars').createSignedUrl(`${content.id}/avatar.jpg`, 60);
    if (signed.error || !signed.data) imageWarnings.push('The reported avatar could not be loaded. Refresh or escalate storage inspection.');
    else images.push({ url: signed.data.signedUrl, label: 'Reported profile avatar' });
  }
  if (content && result.type === 'message' && content.attachment_path) {
    const messageId = String(content.id ?? '');
    const conversationId = String(content.conversation_id ?? '');
    const senderId = String(content.sender_id ?? '');
    const path = String(content.attachment_path);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(messageId) || !uuid.test(conversationId) || !uuid.test(senderId)
      || path !== `${conversationId}/${senderId}/${messageId}.jpg`
      || content.attachment_mime_type !== 'image/jpeg') {
      throw new Error('Invalid reported chat image');
    }
    const signed = await client.storage.from('chat-images').createSignedUrl(path, 60);
    if (signed.error || !signed.data) {
      imageWarnings.push('The reported chat photo could not be loaded. Refresh or escalate storage inspection.');
    } else {
      images.push({ url: signed.data.signedUrl, label: 'Reported chat photo' });
    }
  }
  return { ...result, images, imageWarnings };
}

import type { ListingDraftPhoto } from '@/features/sell/types/listingDraft';
import { requireSupabase } from '@/lib/supabase/client';

const AVATAR_BUCKET = 'profile-avatars';
const AVATAR_FILE = 'avatar.jpg';
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

async function currentAvatarPath() {
  const { data, error } = await requireSupabase().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('You must be signed in to update your profile picture.');
  return `${data.user.id}/${AVATAR_FILE}`;
}

export async function uploadProfileAvatar(photo: ListingDraftPhoto) {
  const response = await fetch(photo.uri);
  if (!response.ok) throw new Error('The selected profile picture could not be read.');
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_AVATAR_BYTES) {
    throw new Error('Choose a profile picture smaller than 8 MB.');
  }

  const client = requireSupabase();
  const path = await currentAvatarPath();
  const { error } = await client.storage.from(AVATAR_BUCKET).upload(path, buffer, {
    cacheControl: '3600',
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;
  const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function removeProfileAvatar() {
  const path = await currentAvatarPath();
  const { error } = await requireSupabase().storage.from(AVATAR_BUCKET).remove([path]);
  if (error) throw error;
}

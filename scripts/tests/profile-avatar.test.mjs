import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/202609080041_add_profile_avatar_storage.sql');
const repository = read('src/features/profile/services/profileAvatarRepository.ts');
const edit = read('src/features/profile/EditProfileScreen.tsx');
const hero = read('src/features/profile/components/ProfileHero.tsx');
const deletionFunction = read('supabase/functions/delete-account/index.ts');
const listingRepository = read('src/features/listings/services/listingRepository.ts');
const productDetails = read('src/features/listings/ProductDetailsScreen.tsx');
const conversation = read('src/features/messaging/ConversationScreen.tsx');
const messageBubble = read('src/features/messaging/components/MessageBubble.tsx');

test('profile avatar storage permits only owner-derived fixed paths', () => {
  assert.match(migration, /'profile-avatars'[\s\S]*true[\s\S]*array\['image\/jpeg'\]/);
  assert.match(migration, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g);
  assert.match(migration, /storage\.filename\(name\) = 'avatar\.jpg'/g);
  assert.match(migration, /owner_id = auth\.uid\(\)::text/g);
  assert.doesNotMatch(repository, /userId\s*:/);
  assert.match(repository, /auth\.getUser\(\)/);
  assert.match(repository, /`\$\{data\.user\.id\}\/\$\{AVATAR_FILE\}`/);
  assert.match(deletionFunction, /from\("profile-avatars"\)\.remove\(\[[\s\S]*`\$\{user\.id\}\/avatar\.jpg`/);
});

test('Edit Profile can add, replace, and remove an avatar while retaining initials fallback', () => {
  assert.match(edit, /launchImageLibraryAsync/);
  assert.match(edit, /uploadProfileAvatar\(pendingPhoto\)/);
  assert.match(edit, /removeProfileAvatar\(\)/);
  assert.match(edit, /Change Photo/);
  assert.match(edit, /Remove Photo/);
  assert.match(hero, /<Avatar imageUri=\{photoUri\} initials=\{initials\}/);
});

test('listing details keep seller avatar URLs separate from initials', () => {
  assert.match(listingRepository, /avatar: name\.split\(\/\\s\+\/\)/);
  assert.match(listingRepository, /avatarUrl: row\.seller\?\.avatar_url \?\? undefined/);
  assert.match(productDetails, /<Avatar imageUri=\{listing\.seller\.avatarUrl\} initials=\{listing\.seller\.avatar\} size=\{46\}/);
  assert.match(productDetails, /<Avatar imageUri=\{listing\.seller\.avatarUrl\} initials=\{listing\.seller\.avatar\} size=\{54\}/);
});

test('chat bubbles place participant avatars beside messages with shared image fallback', () => {
  assert.match(conversation, /senderAvatar=\{item\.fromMe \? \{/);
  assert.match(conversation, /imageUri: profile\?\.avatar_url \?\? undefined/);
  assert.match(conversation, /imageUri: conversation\.participant\.avatarUrl/);
  assert.match(messageBubble, /!message\.fromMe \? avatar : null[\s\S]*message\.fromMe \? avatar : null/);
  assert.match(messageBubble, /<Avatar[\s\S]*imageUri=\{senderAvatar\.imageUri\}[\s\S]*initials=\{senderAvatar\.initials\}/);
  assert.match(conversation, /store\.sendText\(conversationId\)/);
  assert.match(conversation, /<MessageComposer[\s\S]*onAttach=\{\(\) => void pickImage\(\)\}/);
  assert.match(conversation, /ImagePicker\.launchImageLibraryAsync/);
});

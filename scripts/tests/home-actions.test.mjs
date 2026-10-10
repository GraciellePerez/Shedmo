import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const home = readFileSync(new URL('../../src/features/home/HomeScreen.tsx', import.meta.url), 'utf8');

test('home navigation affordances are wired without unfinished AI promotion', () => {
  const browseRoutes = home.match(/router\.push\('\/\(tabs\)\/browse'\)/g) ?? [];
  assert.equal(browseRoutes.length, 3);
  assert.doesNotMatch(home, /AI identifies tools|Coming Soon|NEW FEATURE/);
});


test('Home avatar uses the authenticated profile photo and shared initials fallback', () => {
  const store = readFileSync('src/features/profile/store/ProfileStore.tsx', 'utf8');
  const avatar = readFileSync('src/components/Avatar.tsx', 'utf8');
  assert.match(home, /const \{ profile \} = useProfileStore\(\)/);
  assert.match(store, /photoUri: authProfile\?\.avatar_url \?\? undefined/);
  assert.match(home, /<Avatar imageUri=\{profile\.photoUri\} initials=\{profile\.initials\} \/>/);
  assert.match(avatar, /imageUri && !imageFailed \? \([\s\S]*<Image[\s\S]*source=\{imageUri\}/);
  assert.match(avatar, /onError=\{\(\) => setFailedImageUri\(imageUri\)\}/);
  assert.match(avatar, /const imageFailed = failedImageUri === imageUri/);
  assert.match(avatar, /\) : <Text[^\n]*\{initials\}<\/Text>/);
});

test('Home wraps the entire avatar in a control opening the existing own Profile tab', () => {
  assert.match(home, /<Pressable\s+accessibilityLabel="Your profile"\s+accessibilityRole="button"\s+onPress=\{\(\) => router\.navigate\('\/\(tabs\)\/profile'\)\}\s*>\s*<Avatar[^>]+\/>\s*<\/Pressable>/);
  assert.match(readFileSync('src/app/(tabs)/profile.tsx', 'utf8'), /export \{ ProfileScreen as default \}/);
});

test('Home keeps the notification bell and unread badge immediately before the avatar control', () => {
  assert.match(home, /accessibilityLabel="Notifications" onPress=\{\(\) => router\.push\('\/notifications'\)\}/);
  assert.match(home, /name="notifications-outline"/);
  assert.match(home, /notificationUnreadCount > 0/);
  assert.match(home, /notificationUnreadCount > 9 \? '9\+' : notificationUnreadCount/);
  assert.match(home, /name="notifications-outline"[\s\S]*?<\/Pressable>\s*<Pressable\s+accessibilityLabel="Your profile"/);
});

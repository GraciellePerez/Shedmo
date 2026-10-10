import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app=JSON.parse(readFileSync('app.json','utf8')).expo;
const files=['src/app/+native-intent.tsx','src/features/auth/deepLinkRouting.ts','src/features/auth/store/AuthStore.tsx','src/features/checkout/stripeConfig.tsx','scripts/start-android-dev.ps1','supabase/functions/connect-onboarding-return-redirect/index.ts','supabase/functions/connect-onboarding-refresh-redirect/index.ts'];
const integration=files.map(path=>readFileSync(path,'utf8')).join('\n');
const branded=['src/features/auth/OnboardingScreen.tsx','src/features/auth/components/AuthShell.tsx','src/features/home/HomeScreen.tsx','src/features/account/SettingsScreen.tsx','src/features/checkout/CheckoutScreen.tsx','src/features/listings/ProductDetailsScreen.tsx'].map(path=>readFileSync(path,'utf8')).join('\n');

test('Shedmo native identity is consistent',()=>{assert.equal(app.name,'Shedmo');assert.equal(app.slug,'ProjectMarketplaceMobile');assert.equal(app.scheme,'shedmo');assert.equal(app.ios.bundleIdentifier,'com.gracielleperez.shedmo');assert.equal(app.android.package,'com.gracielleperez.shedmo');});
test('old scheme and application identifiers are absent from integrations',()=>{assert.doesNotMatch(integration,/projectmarketplacemobile|com\.gracielleperez\.marketplace/i);assert.match(integration,/shedmo:\/\/auth\/callback/);assert.match(integration,/shedmo:\/\/reset-password/);assert.match(integration,/shedmo:\/\/\/settings\/payouts\/return/);});
test('primary user-facing surfaces use Shedmo branding',()=>{assert.match(branded,/Shedmo/);assert.doesNotMatch(branded,/Project Marketplace|ProjectMarketplaceMobile|ProjectMarketplace/);});
test('shared authentication screens use the official Shedmo icon',()=>{const shell=readFileSync('src/features/auth/components/AuthShell.tsx','utf8');assert.match(shell,/assets\/shedmo-icon\.png/);assert.doesNotMatch(shell,/name="construct"|LinearGradient/);});
test('welcome screen matches the public Shedmo value proposition and preserves navigation',()=>{const welcome=readFileSync('src/features/auth/OnboardingScreen.tsx','utf8');assert.match(welcome,/assets\/shedmo-icon\.png/);assert.match(welcome,/Buy and sell tools, parts, and equipment nearby\./);assert.match(welcome,/WHY SHEDMO/);assert.match(welcome,/Find local listings/);assert.match(welcome,/See what's available in your area right now\./);assert.match(welcome,/Connect with buyers and sellers/);assert.match(welcome,/Message directly — no middlemen\./);assert.match(welcome,/Build your seller reputation/);assert.match(welcome,/Earn trust with every completed transaction\./);assert.match(welcome,/href="\/sign-up"/);assert.match(welcome,/href="\/sign-in"/);assert.match(welcome,/slug: 'terms'/);assert.match(welcome,/slug: 'privacy-policy'/);assert.match(welcome,/#EF3538/);assert.doesNotMatch(welcome,/name="construct"/);});
test('welcome benefits, actions, and legal links share one safe-area-aware scrolling column', () => {
  const welcome = readFileSync('src/features/auth/OnboardingScreen.tsx', 'utf8');
  const columns = [...welcome.matchAll(/<ScrollView\b[\s\S]*?<\/ScrollView>/g)];
  assert.equal(columns.length, 1, 'welcome content must share one ScrollView');
  const column = columns[0][0];
  assert.equal((column.match(/<ScrollView\b/g) ?? []).length, 1, 'no nested scrolling benefits');
  assert.doesNotMatch(column, /scrollEnabled=\{false\}/);
  assert.match(column, /WHY SHEDMO/);
  assert.match(column, /benefits\.map\(/);
  assert.match(column, /\{benefit\.title\}/);
  assert.match(column, /\{benefit\.description\}/);
  for (const title of ['Find local listings', 'Connect with buyers and sellers', 'Build your seller reputation']) {
    assert.ok(welcome.includes(title), `missing benefit: ${title}`);
  }
  assert.match(column, /<Link asChild href="\/sign-up">[\s\S]*?Create Account[\s\S]*?<\/Link>/);
  assert.match(column, /<Link asChild href="\/sign-in">[\s\S]*?Sign In[\s\S]*?<\/Link>/);
  for (const [slug, label] of [['terms', 'Terms'], ['privacy-policy', 'Privacy Policy']]) {
    const destination = `href={{ pathname: '/settings/[slug]', params: { slug: '${slug}' } }}`;
    assert.ok(column.includes(destination), `missing legal destination: ${slug}`);
    const link = column.slice(column.indexOf(destination)).split('</Link>')[0];
    assert.ok(link.includes(label), `missing legal label: ${label}`);
  }
  assert.match(welcome, /const insets = useSafeAreaInsets\(\)/);
  assert.match(welcome, /paddingTop: insets\.top/);
  assert.match(column, /contentContainerStyle=\{\[styles\.scrollContent, \{ paddingBottom: Math\.max\(10, insets\.bottom\) \}\]\}/);
  assert.match(welcome, /scrollContent:\s*\{\s*flexGrow: 1/);
  assert.match(column, /style=\{styles\.contentArea\}/);
  assert.match(welcome, /contentArea:\s*\{\s*flex: 1/);
  assert.match(welcome, /spacer:\s*\{\s*flex: 1,\s*minHeight: 20/);
  assert.match(welcome, /actions:\s*\{\s*flexShrink: 0/);
  for (const [name, state] of [['primary', 'createPressed'], ['secondary', 'signInPressed']]) {
    const button = column.match(new RegExp(`<Pressable\\b(?:(?!</Pressable>)[\\s\\S])*?style=\\{StyleSheet\\.flatten\\(\\[styles\\.${name}Button, ${state} && styles\\.${name}Pressed\\]\\)\\}[^>]*>[\\s\\S]*?</Pressable>`));
    assert.ok(button, `${name} CTA must pass a resolved style object through Link's Slot`);
    assert.doesNotMatch(button[0], /<Svg|<Path/);
    const style = welcome.match(new RegExp(`${name}Button: \\{([^}]+)\\}`))?.[1];
    assert.ok(style);
    for (const rule of ["height: 54", "borderRadius: 13", "flexShrink: 0", "width: '100%'", "alignItems: 'center'", "justifyContent: 'center'"]) {
      assert.ok(style.includes(rule), `${name} CTA requires ${rule}`);
    }
    assert.ok(style.includes(name === 'primary' ? 'backgroundColor: SHEDMO_RED' : "backgroundColor: '#FFFFFF'"));
    if (name === 'secondary') {
      assert.ok(style.includes('borderWidth: 1.5'));
      assert.ok(style.includes("borderColor: '#E0E0E0'"));
      assert.ok(style.includes('marginTop: 11'));
    }
  }

});
test('the enlarged Sell tab icon has a centered unclipped container',()=>{const tabs=readFileSync('src/app/(tabs)/_layout.tsx','utf8');assert.match(tabs,/route\.name === 'sell' \? <View style=\{styles\.sellIcon\}>\{icon\}<\/View> : icon/);assert.match(tabs,/sellIcon:[\s\S]*alignItems: 'center'[\s\S]*height: 40[\s\S]*justifyContent: 'center'[\s\S]*overflow: 'visible'[\s\S]*translateY: -2/);});
test('Stripe remains test-key only',()=>{assert.match(integration,/startsWith\('pk_test_'\)/);assert.doesNotMatch(integration,/pk_live_/);});

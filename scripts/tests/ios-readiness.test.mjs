import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app=JSON.parse(readFileSync('app.json','utf8')).expo;
const eas=JSON.parse(readFileSync('eas.json','utf8'));
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const stripe=readFileSync('src/features/checkout/stripeConfig.tsx','utf8');
const auth=readFileSync('src/features/auth/store/AuthStore.tsx','utf8');
const links=readFileSync('src/features/auth/deepLinkRouting.ts','utf8');
const sell=readFileSync('src/features/sell/SellScreen.tsx','utf8');
const fulfillment=readFileSync('src/features/fulfillment/FulfillmentOrderScreen.tsx','utf8');

test('iOS identity and EAS profiles are explicit',()=>{assert.equal(app.name,'Shedmo');assert.equal(app.slug,'ProjectMarketplaceMobile');assert.equal(app.ios.bundleIdentifier,'com.gracielleperez.shedmo');assert.equal(app.android.package,'com.gracielleperez.shedmo');assert.equal(app.scheme,'shedmo');assert.equal(app.ios.buildNumber,'1');assert.ok(pkg.dependencies['expo-dev-client']);assert.equal(eas.build.development.developmentClient,true);assert.equal(eas.build.development.distribution,'internal');assert.equal(eas.build.development.environment,'development');assert.equal(eas.build.testflight.distribution,'store');assert.equal(eas.build.testflight.environment,'preview');});
test('iOS permissions are purpose limited and truthful',()=>{const plugins=JSON.stringify(app.plugins);assert.match(plugins,/take photos for marketplace listings/);assert.doesNotMatch(plugins,/scan secure pickup QR codes/);assert.match(plugins,/profile pictures, listings, and dispute evidence/);assert.match(plugins,/approximate listing distances/);assert.match(plugins,/"microphonePermission":false/);assert.match(sell,/Platform\.OS !== 'ios'/);assert.match(fulfillment,/Platform\.OS !== 'ios'/);});
test('Stripe stays test-only without wallet capabilities',()=>{assert.match(stripe,/startsWith\('pk_test_'\)/);assert.match(stripe,/urlScheme="shedmo"/);assert.doesNotMatch(JSON.stringify(app),/merchantIdentifier|enableApplePay|pk_live_/i);});
test('auth callbacks remain separate from recovery and payout routes',()=>{assert.match(auth,/emailRedirectTo: 'shedmo:\/\/auth\/callback'/);assert.match(links,/path === '\/auth\/callback'/);assert.match(links,/type !== 'recovery'/);assert.match(links,/path === '\/settings\/payouts\/return'/);assert.match(links,/path !== '\/reset-password'/);});
test('build declares standard exempt encryption accurately',()=>{assert.equal(app.ios.infoPlist.ITSAppUsesNonExemptEncryption,false);});

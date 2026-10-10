import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SHIPPING_CHARGE_MAX_CENTS, validateFlatShippingPrice, validateShippingDestination } from '../../src/features/checkout/shippingPolicy.ts';

const migration = readFileSync('supabase/migrations/202608160034_add_phase_2a_shipping_foundation.sql', 'utf8');
const conflictFixMigration = readFileSync('supabase/migrations/202608160035_fix_shipping_destination_conflict_target.sql', 'utf8');
const lookupFixMigration = readFileSync('supabase/migrations/202608160036_qualify_shipping_destination_lookup.sql', 'utf8');
const checkoutFunction = readFileSync('supabase/functions/create-checkout-payment/index.ts', 'utf8');
const checkoutScreen = readFileSync('src/features/checkout/CheckoutScreen.tsx', 'utf8');
const repository = readFileSync('src/features/checkout/checkoutRepository.ts', 'utf8');
const fulfillment = readFileSync('src/features/fulfillment/FulfillmentOrderScreen.tsx', 'utf8');
const shippingSafety = readFileSync('src/features/fulfillment/shippingSafetyLabel.ts', 'utf8');
const sellScreen = readFileSync('src/features/sell/SellScreen.tsx', 'utf8');

const valid = {
  recipientName: 'Test Buyer', addressLine1: '123 Main Street', addressLine2: '',
  city: 'Chicago', region: 'IL', postalCode: '60601', countryCode: 'US',
};

test('domestic destination validation accepts only structurally valid minimized fields', () => {
  assert.equal(validateShippingDestination(valid), null);
  assert.match(validateShippingDestination({ ...valid, addressLine1: '' }), /street address/);
  assert.match(validateShippingDestination({ ...valid, recipientName: 'x'.repeat(121) }), /recipient/);
  assert.match(validateShippingDestination({ ...valid, region: 'Illinois' }), /state code/);
  assert.match(validateShippingDestination({ ...valid, postalCode: 'ABC' }), /ZIP/);
  assert.match(validateShippingDestination({ ...valid, countryCode: 'CA' }), /United States/);
});

test('destination freezes transactionally with checkout and retries cannot conflict', () => {
  assert.match(migration, /reserve_listing_for_checkout_v2[\s\S]*reserve_listing_for_checkout\(/);
  assert.match(migration, /insert into public\.order_shipping_destinations/);
  assert.match(migration, /on conflict\(order_id\) do nothing/);
  assert.match(migration, /Checkout destination mismatch/);
  assert.match(migration, /before update or delete on public\.order_shipping_destinations/);
  assert.match(migration, /Protected shipping destination is immutable/);
  assert.match(migration, /revoke all on function public\.reserve_listing_for_checkout\(uuid,text,uuid\) from authenticated/);
  assert.match(checkoutFunction, /reserve_listing_for_checkout_v2/);
  assert.match(conflictFixMigration, /on conflict on constraint order_shipping_destinations_pkey do nothing/);
  assert.doesNotMatch(conflictFixMigration, /on conflict\(order_id\)/);
  assert.match(lookupFixMigration, /destination\.order_id=v_order\.id/);
  assert.match(checkoutFunction, /body\.destination\?\.recipientName/);
});

test('destination RLS reveals it only to buyer, paid seller, and trusted service', () => {
  assert.match(migration, /Buyer reads own protected destination[\s\S]*buyer_id = auth\.uid\(\)/);
  assert.match(migration, /Paid order seller reads operational destination[\s\S]*o\.seller_id=auth\.uid\(\)[\s\S]*o\.payment_status='succeeded'/);
  assert.match(migration, /revoke all on table public\.order_shipping_destinations from public,anon,authenticated/);
  assert.match(migration, /grant select on table public\.order_shipping_destinations to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*order_shipping_destinations to authenticated/i);
});

test('profile, messages, analytics, and logs cannot mutate or receive full destination', () => {
  const destinationBlock = migration.slice(migration.indexOf('create table public.order_shipping_destinations'));
  assert.doesNotMatch(destinationBlock, /insert into public\.(marketplace_analytics_events|marketplace_notification_events|messages)/);
  assert.doesNotMatch(checkoutFunction, /console\.(info|error|warn)\([^\n]*(recipient|address|postal|destination)/i);
  assert.doesNotMatch(repository, /telemetry\.track\([^\n]*(recipient|address|postal|destination)/i);
  assert.match(migration, /order_id uuid primary key references public\.orders\(id\) on delete restrict/);
});

test('workflow version 2 is explicit while legacy orders retain version 1 and null deadline', () => {
  assert.match(migration, /shipping_workflow_version smallint not null default 1/);
  assert.match(migration, /update public\.orders set shipping_workflow_version=2/);
  assert.match(migration, /Version 2 does not imply carrier verification/);
  assert.doesNotMatch(migration, /update public\.orders[^;]*set[^;]*ship_by_at[^;]*where[^;]*shipping_workflow_version=1/i);
  assert.match(fulfillment, /shippingSafetyLabel\(order\.shipping_workflow_version, shipment\)/);
  assert.match(shippingSafety, /Legacy\/manual beta workflow — not carrier verified/);
});

test('deadline is server-owned, calendar based, immutable on duplicate success, and non-enforcing', () => {
  assert.match(migration, /extract\(isodow from v_day\) between 1 and 5/);
  assert.match(migration, /return \(\(v_day \+ 1\)::timestamp at time zone p_timezone\)/);
  assert.match(migration, /v_timezone:='America\/Chicago'/);
  assert.match(migration, /v_timezone_source:='platform_fallback'/);
  assert.match(migration, /coalesce\(ship_by_at,public\.calculate_shipping_deadline_v1/);
  assert.match(migration, /Phase 2A records truth only and does not automatically cancel or refund/);
  assert.doesNotMatch(checkoutFunction, /shipBy|timezone/i);
  assert.doesNotMatch(migration, /cron\.schedule|prepare_order_refund_v1/);
});

test('approved weekday and DST deadline cases resolve to exact UTC boundaries', () => {
  const cases = [
    ['2026-08-17T21:00:00Z', '2026-08-21T05:00:00.000Z'], // Monday
    ['2026-08-18T21:00:00Z', '2026-08-22T05:00:00.000Z'], // Tuesday
    ['2026-08-19T21:00:00Z', '2026-08-25T05:00:00.000Z'], // Wednesday
    ['2026-08-20T21:00:00Z', '2026-08-26T05:00:00.000Z'], // Thursday
    ['2026-08-21T21:00:00Z', '2026-08-27T05:00:00.000Z'], // Friday
    ['2026-08-22T21:00:00Z', '2026-08-27T05:00:00.000Z'], // Saturday
    ['2026-08-23T21:00:00Z', '2026-08-27T05:00:00.000Z'], // Sunday
    ['2026-02-27T22:00:00Z', '2026-03-05T06:00:00.000Z'], // leap-month crossing
    ['2026-03-06T22:00:00Z', '2026-03-12T05:00:00.000Z'], // spring forward
    ['2026-10-30T21:00:00Z', '2026-11-05T06:00:00.000Z'], // fall back
  ];
  for (const [paid, expected] of cases) assert.equal(referenceDeadline(paid, 'America/Chicago'), expected);
});

test('shipping charge is exact cents with a configurable server-owned $500 ceiling', () => {
  assert.equal(SHIPPING_CHARGE_MAX_CENTS, 50_000);
  assert.equal(validateFlatShippingPrice('0'), null);
  assert.equal(validateFlatShippingPrice('24'), null);
  assert.equal(validateFlatShippingPrice('24.50'), null);
  assert.equal(validateFlatShippingPrice('500.00'), null);
  assert.match(validateFlatShippingPrice('1.001'), /two decimal places/);
  assert.match(validateFlatShippingPrice('-1'), /valid amount/);
  assert.match(validateFlatShippingPrice('500.01'), /cannot exceed/);
  assert.match(migration, /shipping_charge_max_cents', 50000/);
  assert.match(migration, /shipping_price \* 100 <> trunc\(new\.shipping_price \* 100\)/);
  assert.match(migration, /shipping_price\*100>v_max/);
  assert.match(migration, /v_order\.shipping_amount<>v_listing\.shipping_price\*100/);
  assert.match(checkoutScreen, /Buyer fee[\s\S]*\$0\.00/);
  assert.match(migration, /v_reserved\.marketplace_fee_amount/);
});

test('public local-only sell flow does not expose legacy shipping controls', () => {
  assert.doesNotMatch(sellScreen, /shippingPrice|sanitizeShippingMoney|Nationwide Shipping/);
});

test('new order repository exposes protected destination and deadline compatibility fields', () => {
  assert.match(repository, /ship_by_at,ship_by_timezone,ship_by_timezone_source,shipping_workflow_version/);
  assert.match(repository, /order_shipping_destinations\(recipient_name,address_line1/);
  assert.match(fulfillment, /Protected destination/);
  assert.match(fulfillment, /Ship by/);
});

function referenceDeadline(instant, timeZone) {
  const local = localDate(new Date(instant), timeZone);
  const cursor = new Date(Date.UTC(local.year, local.month - 1, local.day, 12));
  let count = 0;
  while (count < 3) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) count += 1;
  }
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  return zonedMidnightUtc(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), timeZone).toISOString();
}

function localDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day) };
}

function zonedMidnightUtc(year, month, day, timeZone) {
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(guess));
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const hour = Number(value.hour) === 24 ? 0 : Number(value.hour);
    const represented = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), hour, Number(value.minute), Number(value.second));
    guess = target - (represented - guess);
  }
  return new Date(guess);
}

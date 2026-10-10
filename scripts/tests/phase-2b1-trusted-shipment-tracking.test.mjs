import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202608170037_add_trusted_shipment_tracking_foundation.sql', 'utf8');
const correction = readFileSync('supabase/migrations/202608170038_fix_hardened_tracking_submission.sql', 'utf8');
const legacyEdge = readFileSync('supabase/functions/mark-shipped/index.ts', 'utf8');
const submitEdge = readFileSync('supabase/functions/submit-shipment-tracking/index.ts', 'utf8');
const repository = readFileSync('src/features/checkout/checkoutRepository.ts', 'utf8');
const fulfillment = readFileSync('src/features/fulfillment/FulfillmentOrderScreen.tsx', 'utf8');

test('checkout exposes only the V3 wrapper and closes the renamed helper grant bypass', () => {
  assert.match(migration, /rename to reserve_listing_for_checkout_v2_phase2a_internal/);
  assert.match(migration, /revoke all on function public\.reserve_listing_for_checkout_v2_phase2a_internal[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.reserve_listing_for_checkout_v2\([^;]+\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.reserve_listing_for_checkout_v2_phase2a_internal[^;]+authenticated/);
  assert.match(migration, /security definer set search_path=''/);
});

test('legacy mark-shipped cannot transition a hardened order, while legacy behavior remains defined', () => {
  assert.match(legacyEdge, /mark_order_shipped/);
  assert.match(migration, /if v_order\.shipping_workflow_version=3 then raise exception[\s\S]*Hardened tracking submission is required/);
  assert.match(migration, /insert into public\.order_shipments[\s\S]*update public\.orders set fulfillment_status='shipped'/);
});

test('hardened tracking submission is seller-owned, untrusted, and cannot write shipment proof or payout state', () => {
  assert.match(submitEdge, /p_seller_id: user\.id/);
  assert.match(submitEdge, /submit_order_shipment_tracking_v1/);
  assert.match(migration, /v_order\.seller_id<>p_seller_id/);
  assert.match(migration, /v_order\.fulfillment_type<>'shipping'[\s\S]*shipping_workflow_version<>3[\s\S]*fulfillment_status<>'awaiting_shipment'/);
  assert.match(migration, /shipment_state='tracking_entered',status_source='seller_supplied'/);
  assert.match(migration, /tracking_submitted_at=now\(\)/);
  const submit = migration.match(/create or replace function public\.submit_order_shipment_tracking_v1[\s\S]*?\$\$;/)?.[0] ?? '';
  assert.doesNotMatch(submit, /shipped_at\s*=/);
  assert.doesNotMatch(submit, /fulfillment_status='shipped'|payout_eligible_at|transfer_status=/);
  assert.match(migration, /Unsupported carrier/);
  assert.match(migration, /Invalid tracking number/);
});

test('correction and reuse protections fail closed after acceptance and across active orders', () => {
  assert.match(migration, /shipment_state in \('carrier_accepted','in_transit','delivered'\)[\s\S]*Carrier-accepted tracking requires manual review/);
  assert.match(migration, /correction_count>=2/);
  assert.match(migration, /create unique index order_shipments_active_tracking_unique/);
  assert.match(migration, /on public\.order_shipments\(carrier,tracking_number\)/);
});

test('trusted events are service-only, deduplicated, monotonic, tracker-bound, and non-punitive when delayed', () => {
  assert.match(migration, /verification_delayed/);
  assert.match(migration, /if auth\.role\(\)<>'service_role'/);
  assert.match(migration, /unique\(provider_name,provider_event_id\)/);
  assert.match(migration, /Provider event binding mismatch/);
  assert.match(migration, /Provider tracker binding mismatch/);
  assert.match(migration, /Stale provider event/);
  assert.match(migration, /Delivered shipment cannot regress/);
  assert.match(migration, /Shipment state cannot regress/);
  assert.match(migration, /revoke all on function public\.apply_trusted_shipment_event_v1[\s\S]*public,anon,authenticated/);
});

test('trusted delivery preserves existing inspection gates and the UI submits rather than marks hardened orders shipped', () => {
  assert.match(migration, /p_shipment_state='delivered'[\s\S]*fulfillment_status='inspection_window'[\s\S]*transfer_status='on_hold'/);
  assert.doesNotMatch(migration, /p_shipment_state in \('carrier_accepted','in_transit'\)[\s\S]{0,400}payout_eligible_at/);
  assert.match(repository, /submit-shipment-tracking/);
  assert.match(fulfillment, /order\.shipping_workflow_version === 3 \? 'Submit tracking' : 'Mark shipped'/);
  assert.match(fulfillment, /order\.shipping_workflow_version !== 3/);
  assert.match(fulfillment, /shippingSafetyLabel\(order\.shipping_workflow_version, shipment\)/);
});

test('normalized provider-neutral model preserves raw metadata without arbitrary payloads', () => {
  for (const state of ['tracking_entered', 'tracking_validating', 'pre_shipment', 'carrier_accepted', 'in_transit', 'delivered', 'exception', 'invalid', 'verification_delayed']) {
    assert.match(migration, new RegExp(`'${state}'`));
  }
  assert.match(migration, /provider_name text,\s*add column provider_tracker_id text/);
  assert.doesNotMatch(migration, /provider_payload|raw_payload/i);
});

test('the first hardened submission permits UPS tracking without fabricating shipped_at', () => {
  assert.match(correction, /alter column shipped_at drop not null/);
  assert.match(correction, /v_carrier='UPS' and v_tracking !~ '\^1Z\[0-9A-Z\]\{16\}\$'/);
  assert.match(correction, /v_carrier='USPS' and v_tracking !~ '\^\(\[0-9\]\{20,22\}/);
  const submit = correction.match(/create or replace function public\.submit_order_shipment_tracking_v1[\s\S]*?\$\$;/)?.[0] ?? '';
  assert.match(submit, /values\(p_order_id,v_carrier,v_tracking,'tracking_entered','seller_supplied',now\(\),now\(\)\)/);
  assert.doesNotMatch(submit, /shipped_at\s*=/);
  assert.match(repository, /TRACKING_INVALID/);
});

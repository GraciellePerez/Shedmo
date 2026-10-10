import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const easypost = readFileSync('supabase/functions/_shared/easypost.ts', 'utf8');
const trustedShipment = readFileSync('supabase/functions/_shared/trustedShipment.ts', 'utf8');
const webhook = readFileSync('supabase/functions/easypost-webhook/index.ts', 'utf8');
const submitEdge = readFileSync('supabase/functions/submit-shipment-tracking/index.ts', 'utf8');
const migration039 = readFileSync('docs/retired-migrations/202608180039_add_easypost_tracker_binding.sql', 'utf8');
const migration037 = readFileSync('supabase/migrations/202608170037_add_trusted_shipment_tracking_foundation.sql', 'utf8');
const legacyShipped = readFileSync('supabase/functions/mark-shipped/index.ts', 'utf8');
const pickup = readFileSync('supabase/functions/complete-pickup/index.ts', 'utf8');
const payout = readFileSync('supabase/functions/release-seller-payout/index.ts', 'utf8');
const configToml = readFileSync('supabase/config.toml', 'utf8');

test('EasyPost tracker statuses map to trusted Shedmo states without seller overreach', () => {
  assert.match(easypost, /unknown:\s*"tracking_validating"/);
  assert.match(easypost, /pre_transit:\s*"pre_shipment"/);
  assert.match(easypost, /in_transit:\s*"in_transit"/);
  assert.match(easypost, /out_for_delivery:\s*"in_transit"/);
  assert.match(easypost, /available_for_pickup:\s*"in_transit"/);
  assert.match(easypost, /delivered:\s*"delivered"/);
  assert.match(easypost, /return_to_sender:\s*"exception"/);
  assert.match(easypost, /failure:\s*"exception"/);
  assert.match(easypost, /cancelled:\s*"exception"/);
  assert.doesNotMatch(easypost, /pre_transit:[\s\S]{0,40}carrier_accepted/);
  const mapFn = easypost.match(/export const mapEasyPostTrackerStatus[\s\S]*?};/)?.[0] ?? '';
  assert.match(mapFn, /return EASYPOST_TRACKER_STATUS_MAP/);
  assert.match(mapFn, /return "verification_delayed"/);
});

test('EasyPost failures classify retryable outages separately from definitive invalid tracking', () => {
  const classify = easypost.match(/export const classifyEasyPostFailure[\s\S]*?};/)?.[0] ?? '';
  assert.match(classify, /if \(input\.timedOut\) return "timeout"/);
  assert.match(classify, /status >= 500 && status <= 599\) return "outage"/);
  assert.match(classify, /status === 408 \|\| status === 504\) return "timeout"/);
  assert.match(classify, /INVALID_TRACKING_CODES/);
  assert.match(classify, /return "invalid_tracking"/);
  assert.match(classify, /status === 401 \|\| status === 403/);
  assert.match(classify, /return "auth"/);
  assert.match(classify, /TRACKER\.NO_CARRIER_ACCOUNT[\s\S]*return "config"/);
  assert.doesNotMatch(classify, /status >= 500[\s\S]{0,120}invalid_tracking/);
  assert.doesNotMatch(classify, /status === 401[\s\S]{0,120}invalid_tracking/);
  assert.doesNotMatch(classify, /return "config"[\s\S]{0,80}invalid_tracking/);
  assert.match(easypost, /export const delayedStateForFailure[\s\S]*kind === "invalid_tracking" \? "invalid" : "verification_delayed"/);
  assert.match(trustedShipment, /delayedStateForFailure\(input\.kind\)/);
});

test('seller tracking submission succeeds first and EasyPost registration cannot roll it back', () => {
  const handlerStart = submitEdge.indexOf('authenticatedHandler("submit_shipment_tracking"');
  const handler = submitEdge.slice(handlerStart);
  const rpcIndex = handler.indexOf('submit_order_shipment_tracking_v1');
  const registerIndex = handler.indexOf('registerOutboundTracker');
  assert.ok(rpcIndex >= 0 && registerIndex > rpcIndex, 'seller RPC must precede EasyPost registration');
  assert.match(submitEdge, /await registerOutboundTracker\(admin, submitted\.orderId\)/);
  assert.match(submitEdge, /catch \(error\) \{[\s\S]*EasyPost tracker registration failed[\s\S]*\}[\s\S]*return submitted/);
  assert.doesNotMatch(submitEdge, /registerOutboundTracker[\s\S]{0,400}throw/);
  assert.match(migration037, /shipment_state='tracking_entered',status_source='seller_supplied'/);
  const submitRpc = migration037.match(/create or replace function public\.submit_order_shipment_tracking_v1[\s\S]*?\$\$;/)?.[0] ?? '';
  assert.doesNotMatch(submitRpc, /carrier_accepted_at\s*=/);
  assert.doesNotMatch(submitRpc, /delivered_at\s*=/);
  assert.doesNotMatch(submitRpc, /shipment_state='carrier_accepted'|shipment_state='in_transit'|shipment_state='delivered'/);
  assert.doesNotMatch(submitRpc, /fulfillment_status='inspection_window'/);
  assert.doesNotMatch(submitRpc, /payout_eligible_at|transfer_status=/);
});

test('EasyPost webhook verifies current HMAC-v2 before trusting tracker lookup', () => {
  const rawBodyIndex = webhook.indexOf('const rawBody = await request.text()');
  const parseIndex = webhook.indexOf('JSON.parse(rawBody)');
  assert.ok(rawBodyIndex >= 0 && parseIndex > rawBodyIndex, 'raw body must be read before JSON parsing');
  assert.match(webhook, /request\.headers\.get\("X-Hmac-Signature-v2"\)/);
  assert.match(webhook, /request\.headers\.get\("X-Timestamp"\)/);
  assert.match(webhook, /request\.headers\.get\("X-Path"\)/);
  assert.match(webhook, /requestPath: new URL\(request\.url\)\.pathname|const requestPath = new URL\(request\.url\)\.pathname/);
  assert.match(webhook, /verifyEasyPostWebhookSignatureV2\(\{/);
  assert.doesNotMatch(webhook, /headers\.get\("X-Hmac-Signature"\)/);
  assert.match(easypost, /timestamp.*requestMethod\.toUpperCase\(\).*signedPath.*rawBody/s);
  assert.match(easypost, /signedPath !== input\.requestPath/);
  assert.match(easypost, /EASYPOST_WEBHOOK_TIMESTAMP_TOLERANCE_MS/);
  assert.match(easypost, /EASYPOST_WEBHOOK_FUTURE_SKEW_MS/);
  assert.match(easypost, /timingSafeEqualString\(expected, provided\.toLowerCase\(\)\)/);
  const invalidSigBlock = webhook.match(/if \(!valid\) \{[\s\S]*?\}/)?.[0] ?? '';
  assert.doesNotMatch(invalidSigBlock, /applyEasyPostTrackerEvidence|applyTrustedShipmentEvent|findShipmentByProviderTracker/);
  assert.match(webhook, /return json\(\{ error: "Unauthorized\." \}, 401, false\)/);
  assert.match(webhook, /findShipmentByProviderTracker\(admin, tracker\.id\)/);
  assert.doesNotMatch(webhook, /req\.query|searchParams|body\.order|payload\.order/i);
  assert.match(trustedShipment, /p_provider_name: EASYPOST_PROVIDER/);
  assert.match(trustedShipment, /\.eq\("provider_tracker_id", trackerId\)/);
});

test('provider tracker binding is unique, cross-order safe, and deduplicates provider events', () => {
  assert.match(migration039, /create unique index if not exists order_shipments_provider_tracker_unique/);
  assert.match(migration039, /on public\.order_shipments\(provider_name, provider_tracker_id\)/);
  assert.match(migration039, /where provider_tracker_id is not null/);
  assert.match(migration039, /s\.provider_tracker_id=v_tracker and s\.order_id<>p_order_id[\s\S]*Provider tracker binding mismatch/);
  assert.match(migration039, /from public\.order_shipment_events where provider_name=v_provider and provider_event_id=btrim\(p_provider_event_id\)/);
  assert.match(migration039, /Provider event binding mismatch/);
  assert.match(submitEdge, /findShipmentByProviderTracker\(admin, created\.tracker\.id\)/);
  assert.match(submitEdge, /String\(existing\.order_id\) !== orderId/);
  assert.match(easypost, /export const EASYPOST_PROVIDER = "easypost"/);
  assert.match(trustedShipment, /if \(code === "23505" && message\.includes\("provider_event"\)\) return "duplicate"/);
});

test('migration 039 allows delayed/invalid events without tracker IDs and hardens monotonic delivery', () => {
  assert.match(migration039, /if v_tracker='' and p_shipment_state not in \('verification_delayed','invalid'\)/);
  assert.match(migration039, /Stale provider event/);
  assert.match(migration039, /Delivered shipment cannot regress/);
  assert.match(migration039, /Shipment state cannot regress/);
  assert.match(migration039, /coalesce\(delivered_at,p_occurred_at\)/);
  assert.match(migration039, /coalesce\(inspection_expires_at,p_occurred_at\+interval '48 hours'\)/);
  assert.match(migration039, /coalesce\(carrier_accepted_at,p_occurred_at\)/);
  assert.match(migration039, /First trusted in_transit evidence records carrier_accepted_at and current in-transit state together/);
  assert.match(migration039, /shipment_state=p_shipment_state[\s\S]*carrier_accepted_at=case when p_shipment_state in \('carrier_accepted','in_transit','delivered'\)/);
  const migrationBody = migration039.replace(/^--.*$/gm, '');
  assert.doesNotMatch(migrationBody, /payout_eligible_at|pg_cron|schedule|poll_tracking|process-order-refund|deadline_worker/i);
});

test('first trusted in_transit establishes acceptance and blocks payout while delivery stays idempotent', () => {
  assert.match(migration039, /if p_shipment_state in \('carrier_accepted','in_transit'\) then update public\.orders set fulfillment_status='shipped'/);
  assert.doesNotMatch(migration039, /p_shipment_state='delivered'[\s\S]{0,400}payout_eligible_at/);
  assert.match(migration039, /p_shipment_state='delivered' then update public\.orders set fulfillment_status='inspection_window'[\s\S]*transfer_status='on_hold'/);
  assert.match(migration039, /if v_current_rank=6 and p_shipment_state<>'delivered' then raise exception[\s\S]*Delivered shipment cannot regress/);
  assert.match(trustedShipment, /shipmentState: mapEasyPostTrackerStatus\(input\.tracker\.status\)/);
});

test('Phase 2B.2 EasyPost integration does not alter legacy shipping, pickup, direct local sale, or payout architecture', () => {
  assert.match(legacyShipped, /mark_order_shipped/);
  assert.match(pickup, /complete_pickup/);
  assert.match(payout, /destination: claim\.destinationAccountId/);
  assert.doesNotMatch(easypost, /mark-shipped|complete-pickup|release-seller-payout|stripe-webhook/);
  assert.doesNotMatch(trustedShipment, /mark-shipped|complete-pickup|release-seller-payout|stripe-webhook/);
  assert.doesNotMatch(submitEdge, /mark_order_shipped|complete_pickup|release_seller_payout/);
  assert.doesNotMatch(webhook, /mark_order_shipped|complete_pickup|release_seller_payout/);
  assert.doesNotMatch(migration039, /seller_payout_releases|stripe_|pickup_tokens|fulfillment_type='pickup'/);
  assert.match(configToml, /\[functions\.easypost-webhook\][\s\S]*verify_jwt = false/);
  assert.match(configToml, /\[functions\.submit-shipment-tracking\][\s\S]*verify_jwt = true/);
  assert.match(configToml, /\[functions\.release-seller-payout\]/);
});

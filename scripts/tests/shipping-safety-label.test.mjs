import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { shippingSafetyLabel } from '../../src/features/fulfillment/shippingSafetyLabel.ts';

const fulfillment = readFileSync('src/features/fulfillment/FulfillmentOrderScreen.tsx', 'utf8');

test('legacy and Phase 2A orders keep the manual beta shipping safety label', () => {
  assert.equal(shippingSafetyLabel(1, null), 'Legacy/manual beta workflow — not carrier verified');
  assert.equal(shippingSafetyLabel(2, { carrier: 'UPS', tracking_number: '1Z999', shipped_at: '2026-01-01T00:00:00Z', delivered_at: null, shipment_state: 'legacy_manual' }),
    'Legacy/manual beta workflow — not carrier verified');
});

test('workflow-v3 hardened orders expose carrier-trust labels by shipment state', () => {
  assert.equal(shippingSafetyLabel(3, null), 'Awaiting seller tracking');
  assert.equal(shippingSafetyLabel(3, { carrier: 'UPS', tracking_number: '1Z999AA10123456784', shipped_at: null, delivered_at: null, shipment_state: 'tracking_entered' }),
    'Waiting for carrier acceptance');
  assert.equal(shippingSafetyLabel(3, { carrier: 'UPS', tracking_number: '1Z999AA10123456784', shipped_at: null, delivered_at: null, shipment_state: 'tracking_validating' }),
    'Waiting for carrier acceptance');
  assert.equal(shippingSafetyLabel(3, { carrier: 'UPS', tracking_number: '1Z999AA10123456784', shipped_at: null, delivered_at: null, shipment_state: 'pre_shipment' }),
    'Waiting for carrier acceptance');
  assert.equal(shippingSafetyLabel(3, { carrier: 'UPS', tracking_number: '1Z999AA10123456784', shipped_at: null, delivered_at: null, shipment_state: 'carrier_accepted' }),
    'Carrier has the package');
  assert.equal(shippingSafetyLabel(3, { carrier: 'UPS', tracking_number: '1Z999AA10123456784', shipped_at: null, delivered_at: null, shipment_state: 'in_transit' }),
    'In transit');
  assert.equal(shippingSafetyLabel(3, { carrier: 'UPS', tracking_number: '1Z999AA10123456784', shipped_at: null, delivered_at: null, shipment_state: 'delivered' }),
    'Delivered');
  assert.equal(shippingSafetyLabel(3, { carrier: 'UPS', tracking_number: '1Z999AA10123456784', shipped_at: null, delivered_at: null, shipment_state: 'exception' }),
    'Shipping issue');
  assert.equal(shippingSafetyLabel(3, { carrier: 'UPS', tracking_number: '1Z999AA10123456784', shipped_at: null, delivered_at: null, shipment_state: 'verification_delayed' }),
    'Carrier verification delayed');
});

test('fulfillment order screen derives shipping safety from workflow version and shipment state', () => {
  assert.match(fulfillment, /shippingSafetyLabel\(order\.shipping_workflow_version, shipment\)/);
  assert.doesNotMatch(fulfillment, /Legacy\/manual beta workflow — not carrier verified/);
});

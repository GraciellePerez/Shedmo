import type { OrderShipmentRow } from '@/features/checkout/types';

export function shippingSafetyLabel(
  workflowVersion: 1 | 2 | 3,
  shipment: OrderShipmentRow | null,
): string {
  if (workflowVersion !== 3) return 'Legacy/manual beta workflow — not carrier verified';

  const state = shipment?.shipment_state;
  if (!state || state === 'legacy_manual') return 'Awaiting seller tracking';

  switch (state) {
    case 'tracking_entered':
    case 'tracking_validating':
    case 'pre_shipment':
      return 'Waiting for carrier acceptance';
    case 'carrier_accepted':
      return 'Carrier has the package';
    case 'in_transit':
      return 'In transit';
    case 'delivered':
      return 'Delivered';
    case 'exception':
    case 'invalid':
      return 'Shipping issue';
    case 'verification_delayed':
      return 'Carrier verification delayed';
    default:
      return 'Awaiting seller tracking';
  }
}

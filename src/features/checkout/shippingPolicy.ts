import type { ShippingDestinationInput } from './types';

export const SHIPPING_CHARGE_MAX_CENTS = 50_000;

export function validateFlatShippingPrice(value: string): string | null {
  const normalized = value.trim() || '0';
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return 'Use a valid amount with no more than two decimal places.';
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return 'Enter a valid shipping price.';
  if (Math.round(amount * 100) > SHIPPING_CHARGE_MAX_CENTS) return 'Shipping cannot exceed $500 during the private beta.';
  return null;
}

export function validateShippingDestination(value: ShippingDestinationInput): string | null {
  if (value.recipientName.trim().length < 2 || value.recipientName.trim().length > 120) return 'Enter the recipient name.';
  if (value.addressLine1.trim().length < 3 || value.addressLine1.trim().length > 120) return 'Enter a valid street address.';
  if (value.addressLine2.trim().length > 120) return 'Address line 2 is too long.';
  if (value.city.trim().length < 2 || value.city.trim().length > 80) return 'Enter a valid city.';
  if (!/^[A-Za-z]{2}$/.test(value.region.trim())) return 'Enter a two-letter state code.';
  if (!/^\d{5}(-\d{4})?$/.test(value.postalCode.trim())) return 'Enter a valid US ZIP code.';
  if (value.countryCode !== 'US') return 'Protected shipping is currently available only in the United States.';
  return null;
}

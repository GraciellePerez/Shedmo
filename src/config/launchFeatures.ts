const enabled = (value: string | undefined) => value?.trim().toLowerCase() === 'true';

/**
 * Public V1 defaults to local-only. Shipping can be re-enabled for a controlled
 * beta only when both the shipping and Protected Checkout flags are explicit.
 */
export const PUBLIC_SHIPPING_ENABLED = enabled(
  process.env.EXPO_PUBLIC_ENABLE_PUBLIC_SHIPPING,
);

export const PROTECTED_CHECKOUT_ENABLED = PUBLIC_SHIPPING_ENABLED && enabled(
  process.env.EXPO_PUBLIC_ENABLE_PROTECTED_CHECKOUT,
);

export const LOCAL_ONLY_PUBLIC_V1 = !PUBLIC_SHIPPING_ENABLED;

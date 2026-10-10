const enabled = (name: string) =>
  Deno.env.get(name)?.trim().toLowerCase() === "true";

export const publicShippingEnabled = () =>
  enabled("ENABLE_PUBLIC_SHIPPING");

export const protectedCheckoutEnabled = () =>
  publicShippingEnabled() && enabled("ENABLE_PROTECTED_CHECKOUT");

export const requirePublicShipping = () => {
  if (!publicShippingEnabled()) throw new Error("FEATURE_DISABLED");
};

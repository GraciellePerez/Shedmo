import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
import { useEffect, type PropsWithChildren } from 'react';
import { Linking } from 'react-native';

const candidate = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? '';

export const stripePublishableKey = candidate.startsWith('pk_test_') ? candidate : null;
export const stripeConfigurationError = stripePublishableKey
  ? null
  : 'Stripe test checkout is not configured. Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY with a pk_test_ key and rebuild the development app.';

export function StripeAppProvider({ children }: PropsWithChildren) {
  if (!stripePublishableKey) return children;
  return (
    <StripeProvider
      publishableKey={stripePublishableKey}
      urlScheme="shedmo"
    >
      <StripeUrlHandler />
      <>{children}</>
    </StripeProvider>
  );
}

function StripeUrlHandler() {
  const { handleURLCallback } = useStripe();
  useEffect(() => {
    const handle = (url: string | null) => { if (url) void handleURLCallback(url); };
    void Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => subscription.remove();
  }, [handleURLCallback]);
  return null;
}

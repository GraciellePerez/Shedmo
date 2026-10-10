import type { Listing } from '../../models/marketplace';

type ListingStatus = NonNullable<Listing['status']>;

export interface ProductDetailsActionState {
  checkoutEnabled: boolean;
  checkoutLabel: string;
  evaluateSellerEligibility: boolean;
  showBuyerActions: boolean;
  showLocalMessage: boolean;
  showShippingCheckout: boolean;
  showMakeOffer: boolean;
}

export function getProductDetailsActionState({
  hasPickup,
  hasShipping,
  isOwner,
  offerSupported,
  sellerCheckoutEligible,
  status,
  publicShippingEnabled,
}: {
  hasPickup: boolean;
  hasShipping: boolean;
  isOwner: boolean;
  offerSupported: boolean;
  sellerCheckoutEligible: boolean | null;
  status: ListingStatus;
  publicShippingEnabled: boolean;
}): ProductDetailsActionState {
  if (isOwner) return blocked('Your listing');
  if (status === 'sold') return blocked('Sold');
  if (status === 'reserved') return blocked('Reserved');
  const effectiveShipping = publicShippingEnabled && hasShipping;
  if (status !== 'active' || (!hasPickup && !effectiveShipping)) return blocked('Unavailable');

  const showMakeOffer = offerSupported;
  if (!effectiveShipping) {
    return {
      checkoutEnabled: false,
      checkoutLabel: 'Unavailable',
      evaluateSellerEligibility: false,
      showBuyerActions: true,
      showLocalMessage: hasPickup,
      showShippingCheckout: false,
      showMakeOffer,
    };
  }
  if (sellerCheckoutEligible === false) {
    return {
      checkoutEnabled: false,
      checkoutLabel: 'Seller is still setting up payments',
      evaluateSellerEligibility: true,
      showBuyerActions: true,
      showLocalMessage: hasPickup,
      showShippingCheckout: true,
      showMakeOffer,
    };
  }
  return {
    checkoutEnabled: sellerCheckoutEligible === true,
    checkoutLabel: sellerCheckoutEligible === null ? 'Checking availability' : 'Buy Shipped',
    evaluateSellerEligibility: true,
    showBuyerActions: true,
    showLocalMessage: hasPickup,
    showShippingCheckout: true,
    showMakeOffer,
  };
}

export function isLatestListingRequest(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}

function blocked(checkoutLabel: string): ProductDetailsActionState {
  return {
    checkoutEnabled: false,
    checkoutLabel,
    evaluateSellerEligibility: false,
    showBuyerActions: false,
    showLocalMessage: false,
    showShippingCheckout: false,
    showMakeOffer: false,
  };
}

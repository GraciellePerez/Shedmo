import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

import { mockOrders, mockReviews } from '@/features/account/data/mockAccountData';
import type { MarketplaceOrder, MarketplaceReview } from '@/features/account/types/account';

interface AccountStoreValue {
  orders: MarketplaceOrder[];
  reviews: MarketplaceReview[];
  submitReview: (review: Omit<MarketplaceReview, 'id' | 'date'>) => boolean;
}

const AccountStoreContext = createContext<AccountStoreValue | null>(null);

export function AccountStoreProvider({ children }: PropsWithChildren) {
  const [reviews, setReviews] = useState(mockReviews);

  const submitReview = useCallback((review: Omit<MarketplaceReview, 'id' | 'date'>) => {
    if (reviews.some((item) => item.orderId === review.orderId)) return false;
    setReviews((current) => [{ ...review, id: `review-local-${Date.now()}`, date: 'Just now' }, ...current]);
    return true;
  }, [reviews]);

  const value = useMemo(() => ({
    orders: mockOrders,
    reviews,
    submitReview,
  }), [reviews, submitReview]);

  // Temporary prototype store. All account-management changes reset on reload.
  return <AccountStoreContext.Provider value={value}>{children}</AccountStoreContext.Provider>;
}

export function useAccountStore() {
  const value = useContext(AccountStoreContext);
  if (!value) throw new Error('useAccountStore must be used within AccountStoreProvider.');
  return value;
}

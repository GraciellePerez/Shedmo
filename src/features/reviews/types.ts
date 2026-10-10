export interface MarketplaceReview {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerAvatarUrl: string | null;
  direction: 'buyer_to_seller' | 'seller_to_buyer';
  rating: number;
  body: string | null;
  createdAt: string;
}

export interface OrderReviewStatus {
  eligible: boolean;
  reviewed: boolean;
  direction: 'buyer_to_seller' | 'seller_to_buyer';
}

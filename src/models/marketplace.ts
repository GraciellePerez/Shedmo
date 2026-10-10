export type ListingCondition = 'New' | 'Like New' | 'Good' | 'Fair' | 'For Parts';

export interface SellerInfo {
  id: string;
  name: string;
  rating: number;
  reviews: number;
  verified: boolean;
  joined: string;
  sales: number;
  location: string;
  responseTime: string;
  avatar: string;
  avatarUrl?: string;
}

export interface Listing {
  id: string;
  status?: 'draft' | 'active' | 'reserved' | 'pending_local_confirmation' | 'sold' | 'expired' | 'archived';
  title: string;
  price: number;
  condition: ListingCondition;
  brand: string;
  location: string;
  distance?: string | null;
  distanceMiles?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  postalCode?: string;
  locationSource?: 'device' | 'manual' | 'profile' | null;
  image: string;
  images: string[];
  category: string;
  shipping: boolean;
  shippingCost: number;
  pickup: boolean;
  timeAgo: string;
  views: number;
  description: string;
  createdAt?: string;
  seller: SellerInfo;
  offerOk: boolean;
}

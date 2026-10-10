export type ListingStatus = 'active' | 'pending_local_confirmation' | 'sold' | 'draft' | 'expired' | 'archived';

export interface UserProfile {
  id: string;
  displayName: string;
  username: string;
  initials: string;
  photoUri?: string;
  bio: string;
  city: string;
  state: string;
  postalCode: string;
  verified: boolean;
}

export interface SellerProfile {
  id: string;
  name: string;
  initials: string;
  verified: boolean;
  rating: number;
  reviewCount: number;
  itemsSold: number;
  memberSince: string;
  responseTime: string;
  location: string;
}

export interface EditableProfile {
  displayName: string;
  username: string;
  bio: string;
  city: string;
  state: string;
  postalCode: string;
  photoUri?: string;
}

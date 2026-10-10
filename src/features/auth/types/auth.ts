export interface DatabaseProfile {
  id: string;
  display_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileUpdateInput {
  displayName: string;
  username: string;
  bio: string;
  avatarUrl?: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface AuthActionResult {
  authenticated?: boolean;
  error?: string;
  needsEmailVerification?: boolean;
  success?: string;
}

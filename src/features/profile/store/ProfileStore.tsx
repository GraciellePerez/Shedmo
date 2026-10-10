import { createContext, useCallback, useContext, useMemo, type PropsWithChildren } from 'react';

import type { EditableProfile, UserProfile } from '@/features/profile/types/profile';
import { useAuthStore } from '@/features/auth/store/AuthStore';
import type { AuthActionResult } from '@/features/auth/types/auth';

interface ProfileStoreValue {
  profile: UserProfile;
  updateProfile: (updates: EditableProfile) => Promise<AuthActionResult>;
}

const ProfileStoreContext = createContext<ProfileStoreValue | null>(null);

export function ProfileStoreProvider({ children }: PropsWithChildren) {
  const { emailVerified, profile: authProfile, updateProfile: updateRemoteProfile, user } = useAuthStore();
  const profile = useMemo<UserProfile>(() => {
    const displayName: string = authProfile?.display_name || String(user?.user_metadata.display_name || 'Shedmo User');
    return {
      id: user?.id ?? '',
      displayName,
      username: authProfile?.username || user?.user_metadata.username || 'new_user',
      initials: displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join(''),
      photoUri: authProfile?.avatar_url ?? undefined,
      bio: authProfile?.bio ?? '',
      city: authProfile?.city ?? '',
      state: authProfile?.state ?? '',
      postalCode: authProfile?.postal_code ?? '',
      verified: emailVerified,
    };
  }, [authProfile, emailVerified, user]);

  const updateProfile = useCallback((updates: EditableProfile) => updateRemoteProfile({
    displayName: updates.displayName,
    username: updates.username,
    bio: updates.bio,
    avatarUrl: updates.photoUri,
    city: updates.city,
    state: updates.state,
    postalCode: updates.postalCode,
  }), [updateRemoteProfile]);

  const value = useMemo(() => ({
    profile,
    updateProfile,
  }), [profile, updateProfile]);

  return <ProfileStoreContext.Provider value={value}>{children}</ProfileStoreContext.Provider>;
}

export function useProfileStore() {
  const value = useContext(ProfileStoreContext);
  if (!value) throw new Error('useProfileStore must be used within ProfileStoreProvider.');
  return value;
}

import { router } from 'expo-router';
import { Alert } from 'react-native';

import { CONTENT_SAFETY_MESSAGE, isContentSafetyError } from './contentSafety';

export function showContentSafetyAlert(error: unknown): boolean {
  if (!isContentSafetyError(error)) return false;
  Alert.alert('Content not posted', CONTENT_SAFETY_MESSAGE, [
    { text: 'Edit content', style: 'cancel' },
    { text: 'Marketplace Rules', onPress: () => router.push('/settings/prohibited-items') },
  ]);
  return true;
}

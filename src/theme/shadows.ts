import { Platform, type ViewStyle } from 'react-native';

export const shadows: Record<'card' | 'floating', ViewStyle> = {
  card: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.07,
      shadowRadius: 6,
    },
    android: { elevation: 2 },
    default: {},
  }),
  floating: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.14,
      shadowRadius: 12,
    },
    android: { elevation: 6 },
    default: {},
  }),
};

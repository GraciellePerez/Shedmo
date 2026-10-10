import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '@/theme';

interface AvatarProps {
  backgroundColor?: string;
  initials: string;
  size?: number;
  imageUri?: string;
}

export function Avatar({ backgroundColor = colors.text, imageUri, initials, size = 40 }: AvatarProps) {
  const [failedImageUri, setFailedImageUri] = useState<string | null>(null);
  const imageFailed = failedImageUri === imageUri;

  return (
    <View style={[styles.avatar, { backgroundColor, width: size, height: size, borderRadius: size / 2 }]}>
      {imageUri && !imageFailed ? (
        <Image
          cachePolicy="memory-disk"
          contentFit="cover"
          onError={() => setFailedImageUri(imageUri)}
          recyclingKey={imageUri}
          source={imageUri}
          style={{ height: size, width: size }}
        />
      ) : <Text style={[styles.text, { fontSize: size * 0.34 }]}>{initials}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  text: {
    color: colors.white,
    fontFamily: fontFamily.bold,
  },
});

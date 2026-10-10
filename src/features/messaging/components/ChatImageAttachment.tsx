import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { PhotoViewer } from './PhotoViewer';

import { createChatImageSignedUrl } from '@/features/messaging/services/messagingRepository';
import { colors, fontFamily } from '@/theme';

export function ChatImageAttachment({ path, time }: { path: string; time: string }) {
  const [dimensions, setDimensions] = useState({ width: 230, height: 190 });
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const retry = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    setDimensions({ width: 230, height: 190 });
  }, [path]);

  useEffect(() => {
    let active = true;
    setSignedUrl(null);
    setLoading(true);
    setFailed(false);
    void createChatImageSignedUrl(path).then((url) => {
      if (active) setSignedUrl(url);
    }).catch(() => {
      if (active) setFailed(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [path, refresh]);

  return (
    <>
      <Pressable
        accessibilityLabel={failed ? 'Retry loading image' : 'View image larger'}
        disabled={loading}
        onPress={() => (failed ? retry() : setExpanded(true))}
        style={[styles.imageFrame, { width: dimensions.width, aspectRatio: dimensions.width / dimensions.height }]}
      >
        {signedUrl ? (
          <Image
            cachePolicy="none"
            contentFit="contain"
            onLoad={({ source }) => {
              if (source.width > 0 && source.height > 0) {
                const scale = Math.min(230 / source.width, 190 / source.height);
                setDimensions({ width: source.width * scale, height: source.height * scale });
              }
            }}
            onError={retry}
            source={{ uri: signedUrl }}
            style={styles.preview}
            transition={120}
          />
        ) : (
          <View style={styles.imageFallback}>
            {loading ? <ActivityIndicator color={colors.textSecondary} /> : (
              <>
                <Ionicons color={colors.textSecondary} name="image-outline" size={25} />
                <Text style={styles.fallbackText}>{failed ? 'Tap to retry' : 'Image unavailable'}</Text>
              </>
            )}
          </View>
        )}
        <View pointerEvents="none" style={styles.timestamp}>
          <Text style={styles.timestampText}>{time}</Text>
        </View>
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setExpanded(false)} transparent visible={expanded}>
        {expanded ? <PhotoViewer key={path} uri={signedUrl} dimensions={dimensions} loading={loading} retry={retry} onClose={() => setExpanded(false)} /> : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  imageFrame: { borderRadius: 9, maxWidth: '100%', overflow: 'hidden' },
  timestamp: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  timestampText: { color: colors.white, fontFamily: fontFamily.regular, fontSize: 11 },
  preview: { height: '100%', width: '100%' },
  imageFallback: { alignItems: 'center', backgroundColor: colors.surface, flex: 1, justifyContent: 'center', gap: 5 },
  fallbackText: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 12 },
});

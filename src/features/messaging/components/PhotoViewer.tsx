import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clampPan, fitPhoto, isOutsidePhoto } from './photoViewerGeometry';
import { colors, spacing } from '@/theme';

export function PhotoViewer({ uri, dimensions, loading, retry, onClose }: {
  uri: string | null; dimensions: { width: number; height: number }; loading: boolean;
  retry: () => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [viewport, setViewport] = useState({ width: window.width, height: window.height });
  const size = fitPhoto(dimensions.width, dimensions.height, viewport.width, viewport.height);
  const scale = useSharedValue(1);
  const initialScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const pinch = Gesture.Pinch().onStart(() => { initialScale.value = scale.value; })
    .onUpdate((event) => {
      scale.value = Math.max(1, Math.min(4, initialScale.value * event.scale));
      x.value = clampPan(x.value, size.width, viewport.width, scale.value);
      y.value = clampPan(y.value, size.height, viewport.height, scale.value);
    });
  const pan = Gesture.Pan().maxPointers(1).minDistance(8)
    .onStart(() => { startX.value = x.value; startY.value = y.value; })
    .onUpdate((event) => {
      x.value = clampPan(startX.value + event.translationX, size.width, viewport.width, scale.value);
      y.value = clampPan(startY.value + event.translationY, size.height, viewport.height, scale.value);
    });
  const tap = Gesture.Tap().maxDistance(8).onTouchesDown((event, manager) => {
    if (event.numberOfTouches > 1) manager.fail();
  }).onEnd((event, success) => {
    if (success && uri && isOutsidePhoto(event.x, event.y, size.width, size.height, viewport.width, viewport.height, scale.value, x.value, y.value)) {
      runOnJS(onClose)();
    }
  });
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));

  return (
    <GestureHandlerRootView style={styles.root}>
      <GestureDetector gesture={Gesture.Exclusive(Gesture.Simultaneous(pinch, pan), tap)}>
        <View collapsable={false} style={styles.canvas} onLayout={({ nativeEvent }) => setViewport(nativeEvent.layout)}>
          {uri ? (
            <Animated.View style={[size, transform]}>
              <Image cachePolicy="none" contentFit="contain" onError={retry} source={{ uri }} style={styles.image} />
            </Animated.View>
          ) : (
            <Pressable onPress={retry} style={styles.fallback}>
              <Text style={styles.fallbackText}>{loading ? 'Loading image…' : 'Image unavailable. Tap to retry.'}</Text>
            </Pressable>
          )}
        </View>
      </GestureDetector>
      <Pressable accessibilityLabel="Close image" accessibilityRole="button" hitSlop={8} onPress={onClose}
        style={[styles.close, { top: insets.top + spacing.sm, right: insets.right + spacing.md }]}>
        <Ionicons color={colors.white} name="close" size={30} />
      </Pressable>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  close: { position: 'absolute', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  fallback: { padding: spacing.xl },
  fallbackText: { color: colors.white, textAlign: 'center' },
});

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontFamily, spacing } from '@/theme';

export function ListingGalleryModal({ images, initialIndex, title, visible, onClose }: {
  images: string[]; initialIndex: number; title: string; visible: boolean; onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent visible={visible}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}><Pressable accessibilityLabel="Close gallery" onPress={onClose} style={styles.close}><Ionicons color={colors.white} name="close" size={28} /></Pressable><Text style={styles.count}>{index + 1} / {images.length}</Text><View style={styles.spacer} /></View>
        <FlatList data={images} horizontal initialScrollIndex={initialIndex} keyExtractor={(item, itemIndex) => `${item}:${itemIndex}`} onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))} pagingEnabled renderItem={({ item, index: itemIndex }) => <ZoomableImage label={`${title}, image ${itemIndex + 1}`} source={item} width={width} />} showsHorizontalScrollIndicator={false} windowSize={3} />
        <Text style={styles.hint}>Pinch or double-tap to zoom</Text>
      </SafeAreaView>
    </Modal>
  );
}

function ZoomableImage({ label, source, width }: { label: string; source: string; width: number }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const pinch = Gesture.Pinch().onUpdate((event) => { scale.value = Math.min(4, Math.max(1, savedScale.value * event.scale)); }).onEnd(() => { savedScale.value = scale.value; });
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => { const next = scale.value > 1 ? 1 : 2.5; scale.value = withTiming(next); savedScale.value = next; });
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <GestureDetector gesture={Gesture.Simultaneous(pinch, doubleTap)}><Animated.View style={[styles.imageWrap, { width }, animatedStyle]}><Image accessibilityLabel={label} cachePolicy="memory-disk" contentFit="contain" source={source} style={styles.image} /></Animated.View></GestureDetector>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#000', flex: 1 }, header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md, zIndex: 2 }, close: { padding: spacing.sm }, count: { color: colors.white, fontFamily: fontFamily.semibold }, spacer: { width: 44 }, imageWrap: { flex: 1, justifyContent: 'center', overflow: 'hidden' }, image: { height: '100%', width: '100%' }, hint: { color: '#BBB', fontFamily: fontFamily.medium, padding: spacing.md, textAlign: 'center' },
});

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, type ErrorBoundaryProps, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ListingStoreProvider } from '@/features/listings/store/ListingStore';
import { LocationStoreProvider } from '@/features/location/store/LocationStore';
import { MessagingStoreProvider } from '@/features/messaging/store/MessagingStore';
import { ProfileStoreProvider } from '@/features/profile/store/ProfileStore';
import { AccountStoreProvider } from '@/features/account/store/AccountStore';
import { AuthStoreProvider, useAuthStore } from '@/features/auth/store/AuthStore';
import { FavoritesStoreProvider } from '@/features/favorites/store/FavoritesStore';
import { NotificationStoreProvider } from '@/features/notifications/store/NotificationStore';
import { BrowseStoreProvider } from '@/features/browse/store/BrowseStore';
import { PushNotificationProvider } from '@/features/notifications/hooks/usePushNotifications';
import { BlockingStoreProvider } from '@/features/blocking/BlockingStore';
import { isLegalPath } from '@/features/legal/legalDocuments';
import { telemetry } from '@/services/telemetry';
import { StripeAppProvider } from '@/features/checkout/stripeConfig';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme';

SplashScreen.preventAutoHideAsync();

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    telemetry.recordError(error, { screen: 'root' });
  }, [error]);

  return (
    <View accessibilityRole="alert" style={styles.errorBoundary}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorBody}>
        Your account data is safe. Try reopening this screen.
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void retry()} style={styles.errorButton}>
        <Text style={styles.errorButtonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  const fontsReady = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StripeAppProvider>
          <AuthStoreProvider>
            <AppNavigator />
          </AuthStoreProvider>
        </StripeAppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  errorBoundary: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  errorTitle: { color: colors.text, fontFamily: fontFamily.bold, fontSize: fontSize.title },
  errorBody: {
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  errorButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  errorButtonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
});

function AppNavigator() {
  const {
    clearPasswordRecovery,
    consumePendingPayoutRoute,
    initializing,
    linkingReady,
    passwordRecoveryActive,
    pendingPayoutRoute,
    session,
    signingOut,
  } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();

  useEffect(() => {
    if (initializing || !linkingReady || signingOut || !pendingPayoutRoute) return;
    const target = session ? pendingPayoutRoute : '/(auth)';
    clearPasswordRecovery();
    consumePendingPayoutRoute();
    router.replace(target);
  }, [
    clearPasswordRecovery,
    consumePendingPayoutRoute,
    initializing,
    linkingReady,
    pendingPayoutRoute,
    router,
    session,
    signingOut,
  ]);

  useEffect(() => {
    if (initializing || !linkingReady || signingOut || pendingPayoutRoute) return;
    if (passwordRecoveryActive) {
      if (pathname !== '/reset-password') router.replace('/reset-password');
      return;
    }
    if (pathname === '/reset-password') {
      router.replace(session ? '/(tabs)' : '/(auth)');
    }
  }, [
    initializing,
    linkingReady,
    passwordRecoveryActive,
    pathname,
    pendingPayoutRoute,
    router,
    session,
    signingOut,
  ]);

  useEffect(() => {
    if (initializing || !linkingReady || signingOut || session || pendingPayoutRoute) return;
    const rootSegment = segments[0];
    if (rootSegment !== '(auth)' && !isLegalPath(pathname) && !passwordRecoveryActive) {
      router.replace('/(auth)');
    }
  }, [
    initializing,
    linkingReady,
    passwordRecoveryActive,
    pendingPayoutRoute,
    router,
    segments,
    pathname,
    session,
    signingOut,
  ]);

  if (initializing) return null;

  return (
    <>
      <BlockingStoreProvider>
      <PushNotificationProvider>
      <LocationStoreProvider>
      <ListingStoreProvider>
        <BrowseStoreProvider>
        <FavoritesStoreProvider>
          <ProfileStoreProvider>
            <NotificationStoreProvider>
              <AccountStoreProvider>
                <MessagingStoreProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Protected guard={!session}>
                  <Stack.Screen name="(auth)" />
                </Stack.Protected>
                <Stack.Screen name="reset-password" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="auth/callback" options={{ animation: 'fade' }} />
                <Stack.Protected guard={Boolean(session)}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="listings/[id]" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="my-listings" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="edit-listing/[id]" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="saved-items" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="edit-profile" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="sellers/[id]" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="conversations/[id]" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="purchases" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="sales" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="orders/[id]" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="checkout/[listingId]" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="orders/confirmation/[id]" options={{ animation: 'fade' }} />
                  <Stack.Screen name="reviews/[sellerId]" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="leave-review/[orderId]" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="help-support" options={{ animation: 'slide_from_right' }} />
                </Stack.Protected>
              </Stack>
                </MessagingStoreProvider>
              </AccountStoreProvider>
            </NotificationStoreProvider>
          </ProfileStoreProvider>
        </FavoritesStoreProvider>
        </BrowseStoreProvider>
      </ListingStoreProvider>
      </LocationStoreProvider>
      </PushNotificationProvider>
      </BlockingStoreProvider>
    </>
  );
}

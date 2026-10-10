import { useState } from 'react';
import { useFonts } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { useAuthStore } from '@/features/auth/store/AuthStore';
import { colors, radii, spacing } from '@/theme';

const SHEDMO_RED = '#EF3538';

const benefits = [
  {
    description: "See what's available in your area right now.",
    icon: 'location-outline',
    title: 'Find local listings',
  },
  {
    description: 'Message directly — no middlemen.',
    icon: 'chatbox-outline',
    title: 'Connect with buyers and sellers',
  },
  {
    description: 'Earn trust with every completed transaction.',
    icon: 'star-outline',
    title: 'Build your seller reputation',
  },
] satisfies {
  description: string;
  icon: 'location-outline' | 'chatbox-outline' | 'star-outline';
  title: string;
}[];

// Paths and dimensions are copied from the Figma export.
function BenefitIcon({ name }: { name: (typeof benefits)[number]['icon'] }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      {name === 'location-outline' ? (
        <>
          <Path d="M9 1.5C6.515 1.5 4.5 3.515 4.5 6c0 3.75 4.5 10.5 4.5 10.5S13.5 9.75 13.5 6c0-2.485-2.015-4.5-4.5-4.5z" fill={SHEDMO_RED} fillOpacity={0.12} stroke={SHEDMO_RED} strokeWidth={1.5} strokeLinejoin="round" />
          <Circle cx={9} cy={6} r={1.5} fill={SHEDMO_RED} />
        </>
      ) : name === 'chatbox-outline' ? (
        <>
          <Path d="M2 3a1 1 0 011-1h12a1 1 0 011 1v9a1 1 0 01-1 1H6l-4 3V3z" fill={SHEDMO_RED} fillOpacity={0.12} stroke={SHEDMO_RED} strokeWidth={1.5} strokeLinejoin="round" />
          <Path d="M5.5 7.5h7M5.5 10h4.5" stroke={SHEDMO_RED} strokeWidth={1.4} strokeLinecap="round" />
        </>
      ) : (
        <Path d="M9 2l1.8 3.7L15 6.5l-3 2.9.7 4.1L9 11.5l-3.7 2 .7-4.1L3 6.5l4.2-.8L9 2z" fill={SHEDMO_RED} fillOpacity={0.12} stroke={SHEDMO_RED} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      )}
    </Svg>
  );
}

export function OnboardingScreen() {
  const { configurationError } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [createPressed, setCreatePressed] = useState(false);
  const [signInPressed, setSignInPressed] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular: require('../../../assets/fonts/outfit/Outfit_400Regular.ttf'),
    Outfit_600SemiBold: require('../../../assets/fonts/outfit/Outfit_600SemiBold.ttf'),
    Outfit_700Bold: require('../../../assets/fonts/outfit/Outfit_700Bold.ttf'),
    Outfit_800ExtraBold: require('../../../assets/fonts/outfit/Outfit_800ExtraBold.ttf'),
  });

  if (!fontsLoaded && !fontError) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {/* Native status-bar inset replaces the reference's display chrome. */}
      <View style={[styles.brandArea, { paddingTop: insets.top }]}>
        <View style={styles.brandContent}>
          <Image
            accessibilityLabel="Shedmo logo"
            contentFit="contain"
            source={require('../../../assets/shedmo-icon.png')}
            style={styles.logo}
          />
          <Text style={styles.brandName}>Shedmo</Text>
          <Text style={styles.tagline}>
            Buy and sell tools, parts, and equipment nearby.
          </Text>
        </View>
      </View>

      <LinearGradient
        colors={['rgba(239,53,56,0)', SHEDMO_RED, SHEDMO_RED, 'rgba(239,53,56,0)']}
        locations={[0, 0.4, 0.6, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.divider}
      />

      {/* Reserve the native home-indicator inset, with a 10-point minimum. */}
      <ScrollView
        bounces={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(10, insets.bottom) }]}
        showsVerticalScrollIndicator={false}
        style={styles.contentArea}
      >
        <Text style={styles.sectionLabel}>WHY SHEDMO</Text>

        <View style={styles.benefitList}>
          {benefits.map((benefit) => (
            <View key={benefit.title} style={styles.benefitRow}>
              <View style={styles.iconContainer}>
                <BenefitIcon name={benefit.icon} />
              </View>
              <View style={styles.benefitCopy}>
                <Text style={styles.benefitTitle}>{benefit.title}</Text>
                <Text style={styles.benefitDescription}>{benefit.description}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.spacer} />

        <View style={styles.actions}>
          {configurationError ? (
            <View style={styles.configurationAlert}>
              <Text style={styles.configurationAlertText}>{configurationError}</Text>
            </View>
          ) : null}

          {/* Link's Slot merges style objects; resolve pressed styles before passing them. */}
          <Link asChild href="/sign-up">
            <Pressable
              onPressIn={() => setCreatePressed(true)}
              onPressOut={() => setCreatePressed(false)}
              style={StyleSheet.flatten([styles.primaryButton, createPressed && styles.primaryPressed])}
            >
              <Text style={styles.primaryButtonText}>Create Account</Text>
            </Pressable>
          </Link>

          <Link asChild href="/sign-in">
            <Pressable
              onPressIn={() => setSignInPressed(true)}
              onPressOut={() => setSignInPressed(false)}
              style={StyleSheet.flatten([styles.secondaryButton, signInPressed && styles.secondaryPressed])}
            >
              <Text style={styles.secondaryButtonText}>Sign In</Text>
            </Pressable>
          </Link>

          <Text style={styles.legalText}>
            By continuing, you agree to our{' '}
            <Link
              href={{ pathname: '/settings/[slug]', params: { slug: 'terms' } }}
              style={styles.legalLink}
            >
              Terms
            </Link>{' '}
            and{' '}
            <Link
              href={{ pathname: '/settings/[slug]', params: { slug: 'privacy-policy' } }}
              style={styles.legalLink}
            >
              Privacy Policy
            </Link>
            .
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  brandArea: {
    flexShrink: 0,
    backgroundColor: '#1C1C1E',
  },
  brandContent: {
    alignItems: 'center',
    paddingBottom: 48,
    paddingHorizontal: 26,
    paddingTop: 36,
  },
  logo: {
    borderRadius: 16,
    height: 66,
    width: 66,
  },
  brandName: {
    color: '#FFFFFF',
    includeFontPadding: false,
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 32,
    letterSpacing: -1.1,
    lineHeight: 32,
    marginTop: 9,
  },
  tagline: {
    color: 'rgba(255,255,255,0.48)',
    includeFontPadding: false,
    fontFamily: 'Outfit_400Regular',
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0.1,
    marginTop: 10,
    maxWidth: 244,
    textAlign: 'center',
  },
  divider: {
    height: 1,
    flexShrink: 0,
  },
  contentArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 26,
    paddingTop: 30,
  },
  sectionLabel: {
    color: '#8A8A8E',
    includeFontPadding: false,
    fontFamily: 'Outfit_700Bold',
    fontSize: 10.5,
    lineHeight: 15.75,
    letterSpacing: 1.4,
  },
  benefitList: {
    gap: 16,
    marginTop: 18,
  },
  benefitRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  iconContainer: {
    alignItems: 'center',
    backgroundColor: '#F7F7F8',
    borderColor: '#E0E0E0',
    borderRadius: 10,
    borderWidth: 1,
    flexShrink: 0,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  benefitCopy: {
    flex: 1,
    marginLeft: 14,
    paddingTop: 1,
  },
  benefitTitle: {
    color: '#1C1C1E',
    includeFontPadding: false,
    fontFamily: 'Outfit_700Bold',
    fontSize: 15,
    lineHeight: 18.75,
  },
  benefitDescription: {
    color: '#8A8A8E',
    includeFontPadding: false,
    fontFamily: 'Outfit_400Regular',
    fontSize: 13,
    lineHeight: 18.85,
    marginTop: 3,
  },
  spacer: {
    flex: 1,
    minHeight: 20,
  },
  actions: {
    flexShrink: 0,
  },
  configurationAlert: {
    backgroundColor: '#FDECEC',
    borderRadius: radii.md,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  configurationAlertText: {
    color: colors.primary,
    includeFontPadding: false,
    fontFamily: 'Outfit_400Regular',
    fontSize: 14,
    lineHeight: 19,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: SHEDMO_RED,
    borderRadius: 13,
    height: 54,
    flexShrink: 0,
    width: '100%',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    includeFontPadding: false,
    fontFamily: 'Outfit_700Bold',
    fontSize: 16,
    letterSpacing: -0.2,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E0E0E0',
    borderRadius: 13,
    borderWidth: 1.5,
    height: 54,
    flexShrink: 0,
    width: '100%',
    justifyContent: 'center',
    marginTop: 11,
  },
  secondaryButtonText: {
    color: '#2C2C2E',
    includeFontPadding: false,
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 16,
    letterSpacing: -0.2,
  },
  primaryPressed: {
    backgroundColor: '#D42E31',
  },
  secondaryPressed: {
    backgroundColor: '#F7F7F8',
  },
  legalText: {
    color: '#AEAEB2',
    includeFontPadding: false,
    fontFamily: 'Outfit_400Regular',
    fontSize: 11.5,
    lineHeight: 17.8,
    marginTop: 14,
    textAlign: 'center',
  },
  legalLink: {
    color: '#2C2C2E',
    includeFontPadding: false,
    fontFamily: 'Outfit_400Regular',
    textDecorationLine: 'underline',
  },
});

import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, fontFamily } from '@/theme';
import { useMessagingStore } from '@/features/messaging/store/MessagingStore';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icons: Record<string, { active: IconName; inactive: IconName }> = {
  index: { active: 'home', inactive: 'home-outline' },
  browse: { active: 'search', inactive: 'search-outline' },
  sell: { active: 'add-circle', inactive: 'add-circle-outline' },
  inbox: { active: 'chatbubble', inactive: 'chatbubble-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

export default function TabsLayout() {
  const { unreadCount } = useMessagingStore();
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 10 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 82,
          paddingBottom: 18,
          paddingTop: 8,
        },
        tabBarIcon: ({ color, focused, size }) => {
          const routeIcons = icons[route.name] ?? icons.index;
          const icon = <Ionicons color={color} name={focused ? routeIcons.active : routeIcons.inactive} size={route.name === 'sell' ? size + 8 : size} />;
          return route.name === 'sell' ? <View style={styles.sellIcon}>{icon}</View> : icon;
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="browse" options={{ title: 'Browse' }} />
      <Tabs.Screen name="sell" options={{ title: 'Sell' }} />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarBadge: unreadCount > 0 ? unreadCount > 99 ? '99+' : unreadCount : undefined,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  sellIcon: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    overflow: 'visible',
    transform: [{ translateY: -2 }],
    width: 40,
  },
});

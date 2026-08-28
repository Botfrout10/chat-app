import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter, useSegments } from "expo-router";
import { useEffect, useMemo } from "react";
import { LayoutAnimation, PanResponder, Platform, UIManager, View } from "react-native";

import { useNotifications } from "@/hooks/queries";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";

export default function TabsLayout() {
  const t = useTheme();
  const { token } = useSession();
  const notifQuery = useNotifications(20_000, !!token);
  const unread = notifQuery.data?.unread ?? 0;
  const router = useRouter();
  const segments = useSegments() as string[];
  const currentTab = segments[1] ?? "chats";

  const order = ["chats", "search", "activity", "settings"] as const;
  const idx = useMemo(() => {
    const i = order.indexOf(currentTab as any);
    return i === -1 ? 0 : i;
  }, [currentTab]);

  // LayoutAnimation is no-op on New Architecture — only enable on old arch to avoid warning
  useEffect(() => {
    const isFabric = !!(globalThis as any).nativeFabricUIManager;
    if (Platform.OS === "android" && !isFabric && UIManager.setLayoutAnimationEnabledExperimental) {
      try {
        UIManager.setLayoutAnimationEnabledExperimental(true);
      } catch {}
    }
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < 50) return;
          const isLeft = g.dx < 0;
          const isRight = g.dx > 0;
          const velocityOk = Math.abs(g.vx) > 0.15 || Math.abs(g.dx) > 80;
          if (!velocityOk) return;
          const nextIdx = isLeft ? idx + 1 : isRight ? idx - 1 : idx;
          if (nextIdx < 0 || nextIdx >= order.length || nextIdx === idx) return;
          const isFabric = !!(globalThis as any).nativeFabricUIManager;
          if (Platform.OS !== "web" && !isFabric) {
            try {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            } catch {}
          }
          router.push(`/(tabs)/${order[nextIdx]}` as any);
        },
      }),
    [idx, router],
  );

  const blocker = useRequireSession();
  if (blocker) return blocker;

  return (
    <View style={{ flex: 1 }} {...panResponder.panHandlers}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: t.primary,
          tabBarInactiveTintColor: t.mutedForeground,
          tabBarStyle: {
            backgroundColor: t.card,
            borderTopColor: t.border,
          },
          sceneStyle: { backgroundColor: t.background },
        }}
      >
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-ellipses-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Activity",
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size} color={color} />
          ),
        }}
      />
      </Tabs>
    </View>
  );
}

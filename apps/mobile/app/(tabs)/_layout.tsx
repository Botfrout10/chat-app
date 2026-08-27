import { Ionicons } from "@expo/vector-icons";
import { Tabs, usePathname, useRouter } from "expo-router";
import { useMemo } from "react";
import { PanResponder, View } from "react-native";

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
  const pathname = usePathname();

  const order = ["/(tabs)/chats", "/(tabs)/search", "/(tabs)/activity", "/(tabs)/settings"] as const;
  const idx = useMemo(() => {
    const i = order.findIndex((p) => pathname === p || pathname.startsWith(p + "/"));
    return i === -1 ? 0 : i;
  }, [pathname]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < 70 || Math.abs(g.vx) < 0.2) return;
          if (g.dx < 0 && idx < order.length - 1) {
            router.push(order[idx + 1] as any);
          } else if (g.dx > 0 && idx > 0) {
            router.push(order[idx - 1] as any);
          }
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

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { useNotifications } from "@/hooks/queries";
import { useTheme } from "@/theme/useTheme";
import type { AppNotification, NotificationType } from "@/types";

const TYPE_ICON: Record<NotificationType, keyof typeof Ionicons.glyphMap> = {
  mention: "at",
  dm: "chatbubble-ellipses",
  thread: "git-branch",
  channel: "megaphone",
};

export default function Activity() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const notifQuery = useNotifications();

  const markAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const items = notifQuery.data?.items ?? [];
  const unread = notifQuery.data?.unread ?? 0;

  function open(n: AppNotification) {
    if (!n.read) markOne.mutate(n.id);
    router.push({ pathname: "/channel/[id]", params: { id: n.channelId } });
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
      <View style={styles.header}>
        <Text style={[styles.heading, { color: t.foreground }]}>Activity</Text>
        {unread > 0 && (
          <Pressable onPress={() => markAll.mutate()} hitSlop={8} disabled={markAll.isPending}>
            <Text style={{ color: t.primary, fontWeight: "600", fontSize: 14 }}>
              Mark all read
            </Text>
          </Pressable>
        )}
      </View>

      {!items.length && !notifQuery.isPending ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-off-outline" size={36} color={t.border} />
          <Text style={{ color: t.mutedForeground, marginTop: 8 }}>You're all caught up</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          refreshControl={
            <RefreshControl refreshing={notifQuery.isRefetching} onRefresh={() => void notifQuery.refetch()} />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? t.muted : item.read ? "transparent" : t.accent50 },
              ]}
            >
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: item.read ? t.muted : t.accent100 },
                ]}
              >
                <Ionicons
                  name={TYPE_ICON[item.type] ?? "notifications"}
                  size={18}
                  color={item.read ? t.mutedForeground : t.accent700}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: t.foreground,
                    fontWeight: item.read ? "500" : "700",
                    fontSize: 15,
                  }}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <Text style={{ color: t.mutedForeground, fontSize: 13 }} numberOfLines={2}>
                  {item.body}
                </Text>
              </View>
              {!item.read && <View style={[styles.dot, { backgroundColor: t.destructive }]} />}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  heading: { fontSize: 26, fontWeight: "800" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
});

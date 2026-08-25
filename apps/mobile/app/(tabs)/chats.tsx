import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { useChannels, useMembers, useWorkspaces } from "@/hooks/queries";
import { channelTitle, initials, isDmLike } from "@/lib/channelTitle";
import { useChatStore } from "@/stores/chat";
import { useTheme } from "@/theme/useTheme";
import type { Channel } from "@/types";

export default function Chats() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<"workspace" | "dm" | null>(null);

  const workspacesQuery = useWorkspaces();
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useChatStore((s) => s.setActiveWorkspace);
  const presence = useChatStore((s) => s.presence);

  // default to first workspace once loaded
  useEffect(() => {
    if (!activeWorkspaceId && workspacesQuery.data?.length) {
      setActiveWorkspace(workspacesQuery.data[0].id);
    }
  }, [activeWorkspaceId, workspacesQuery.data, setActiveWorkspace]);

  const channelsQuery = useChannels(activeWorkspaceId);

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications(),
    refetchInterval: 20_000,
  });

  const unreadByChannel = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of notificationsQuery.data?.items ?? []) {
      if (!n.read && n.channelId) map[n.channelId] = (map[n.channelId] ?? 0) + 1;
    }
    return map;
  }, [notificationsQuery.data]);

  const channels = channelsQuery.data ?? [];
  const channelList = channels.filter((c) => !isDmLike(c));
  const dmList = channels.filter(isDmLike);

  const activeWs = workspacesQuery.data?.find((w) => w.id === activeWorkspaceId);

  function openChannel(c: Channel) {
    router.push({
      pathname: "/channel/[id]",
      params: { id: c.id, name: channelTitle(c), type: c.type },
    });
  }

  function peerOf(c: Channel): string | null {
    return !Array.isArray(c.dmPeer) && c.dmPeer ? c.dmPeer.id : null;
  }

  async function refresh() {
    await Promise.all([
      workspacesQuery.refetch(),
      activeWorkspaceId ? channelsQuery.refetch() : Promise.resolve(),
      notificationsQuery.refetch(),
    ]);
  }

  async function handleDmCreated(channelId: string, name: string) {
    setModal(null);
    await queryClient.invalidateQueries({ queryKey: ["channels", activeWorkspaceId] });
    router.push({ pathname: "/channel/[id]", params: { id: channelId, name, type: "dm" } });
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
      {/* header */}
      <View style={styles.header}>
        <Text style={[styles.wsName, { color: t.foreground }]} numberOfLines={1}>
          {activeWs?.name ?? "Pulse"}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setModal("workspace")}
          style={[styles.headerBtn, { backgroundColor: t.muted }]}
        >
          <Ionicons name="swap-horizontal" size={18} color={t.primary} />
        </Pressable>
      </View>

      {(channelsQuery.isPending || workspacesQuery.isPending) && (
        <ActivityIndicator style={{ marginTop: 24 }} color={t.primary} />
      )}

      <FlatList
        data={[{ kind: "channels" as const }, { kind: "dms" as const }]}
        keyExtractor={(item) => item.kind}
        renderItem={({ item }) =>
          item.kind === "channels" ? (
            <Section title={`Channels${channelList.length ? ` — ${channelList.length}` : ""}`}>
              {channelList.map((c) => (
                <Row
                  key={c.id}
                  channel={c}
                  unread={unreadByChannel[c.id] ?? 0}
                  online={false}
                  onPress={() => openChannel(c)}
                />
              ))}
              {!channelList.length && !channelsQuery.isPending && <Empty text="No channels yet" />}
            </Section>
          ) : (
            <Section
              title={`Direct messages${dmList.length ? ` — ${dmList.length}` : ""}`}
              actionLabel="New"
              onAction={() => setModal("dm")}
            >
              {dmList.map((c) => (
                <Row
                  key={c.id}
                  channel={c}
                  unread={unreadByChannel[c.id] ?? 0}
                  online={presence[peerOf(c) ?? ""] === "online"}
                  onPress={() => openChannel(c)}
                />
              ))}
              {!dmList.length && !channelsQuery.isPending && (
                <Empty text="No DMs yet — start one from a member" />
              )}
            </Section>
          )
        }
        refreshing={channelsQuery.isRefetching}
        onRefresh={refresh}
        contentContainerStyle={{ paddingBottom: 24 }}
      />

      {/* workspace switcher */}
      <Modal
        visible={modal === "workspace"}
        transparent
        animationType="fade"
        onRequestClose={() => setModal(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setModal(null)}>
          <View style={[styles.modalCard, { backgroundColor: t.card }]}>
            <Text style={[styles.modalTitle, { color: t.foreground }]}>Workspaces</Text>
            {(workspacesQuery.data ?? []).map((w) => (
              <Pressable
                key={w.id}
                onPress={() => {
                  setActiveWorkspace(w.id);
                  setModal(null);
                }}
                style={[
                  styles.wsRow,
                  {
                    backgroundColor: w.id === activeWorkspaceId ? t.accent50 : "transparent",
                    borderColor: t.border,
                  },
                ]}
              >
                <View style={[styles.wsAvatar, { backgroundColor: t.accent100 }]}>
                  <Text style={{ color: t.accent700, fontWeight: "700" }}>{initials(w.name)}</Text>
                </View>
                <Text style={[styles.rowTitle, { color: t.foreground, flex: 1 }]}>{w.name}</Text>
                {w.id === activeWorkspaceId && <Ionicons name="checkmark" size={18} color={t.primary} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* new-DM member picker */}
      <DmPickerModal
        visible={modal === "dm"}
        workspaceId={activeWorkspaceId}
        onClose={() => setModal(null)}
        onCreated={handleDmCreated}
      />
    </SafeAreaView>
  );
}

function DmPickerModal({
  visible,
  workspaceId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  workspaceId: string | null | undefined;
  onClose: () => void;
  onCreated: (channelId: string, name: string) => void | Promise<void>;
}) {
  const t = useTheme();
  const membersQuery = useMembers(visible ? workspaceId : null);
  const [error, setError] = useState<string | null>(null);

  const dmMutation = useMutation({
    mutationFn: (userId: string) => api.findOrCreateDm(workspaceId!, userId),
    onSuccess: (channel) => onCreated(channel.id, channelTitle(channel)),
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to open DM"),
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.modalCard, { backgroundColor: t.card }]}>
          <Text style={[styles.modalTitle, { color: t.foreground }]}>Start a conversation</Text>
          {!!error && <Text style={{ color: t.destructive, fontSize: 13 }}>{error}</Text>}
          {membersQuery.isPending && <ActivityIndicator color={t.primary} />}
          {(membersQuery.data ?? []).map((m) => (
            <Pressable
              key={m.id}
              disabled={dmMutation.isPending}
              onPress={() => dmMutation.mutate(m.id)}
              style={({ pressed }) => [
                styles.wsRow,
                { borderWidth: 0, paddingVertical: 8, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View style={[styles.wsAvatar, { backgroundColor: t.accent100 }]}>
                <Text style={{ color: t.accent700, fontWeight: "700" }}>{initials(m.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: t.foreground }]}>{m.name}</Text>
                <Text style={{ color: t.mutedForeground, fontSize: 12 }}>{m.email}</Text>
              </View>
              {dmMutation.isPending && dmMutation.variables === m.id && (
                <ActivityIndicator color={t.primary} size="small" />
              )}
            </Pressable>
          ))}
          {!membersQuery.isPending && !(membersQuery.data ?? []).length && (
            <Text style={{ color: t.mutedForeground, fontSize: 13 }}>No other members yet</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 16 }}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: t.mutedForeground }]}>{title.toUpperCase()}</Text>
        {actionLabel && (
          <Pressable onPress={onAction} hitSlop={8}>
            <Text style={{ color: t.primary, fontWeight: "600", fontSize: 13 }}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function Row({
  channel,
  unread,
  online,
  onPress,
}: {
  channel: Channel;
  unread: number;
  online: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const dm = isDmLike(channel);
  const label = channelTitle(channel);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      {dm ? (
        <View style={[rowStyles.avatar, { backgroundColor: t.accent100 }]}>
          <Text style={{ color: t.accent700, fontWeight: "700", fontSize: 13 }}>
            {initials(label)}
          </Text>
          <View
            style={[
              rowStyles.dot,
              { backgroundColor: online ? t.success : t.border, borderColor: t.background },
            ]}
          />
        </View>
      ) : (
        <View style={[rowStyles.hashWrap, { backgroundColor: t.muted }]}>
          {channel.type === "private" ? (
            <Ionicons name="lock-closed" size={16} color={t.mutedForeground} />
          ) : (
            <Text style={{ color: t.mutedForeground, fontWeight: "600", fontSize: 16 }}>#</Text>
          )}
        </View>
      )}
      <Text
        style={[
          styles.rowTitle,
          { color: t.foreground, fontWeight: unread > 0 ? "700" : "500", flex: 1 },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {unread > 0 && (
        <View style={[rowStyles.badge, { backgroundColor: t.destructive }]}>
          <Text style={rowStyles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Empty({ text }: { text: string }) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: t.mutedForeground,
        paddingHorizontal: 16,
        paddingVertical: 8,
        fontSize: 13,
      }}
    >
      {text}
    </Text>
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
    paddingBottom: 4,
  },
  wsName: { fontSize: 26, fontWeight: "800", flex: 1 },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowTitle: { fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#00000066",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: { borderRadius: 20, padding: 16, width: "82%", gap: 8 },
  modalTitle: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  wsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
  },
  wsAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});

const rowStyles = StyleSheet.create({
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  hashWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});

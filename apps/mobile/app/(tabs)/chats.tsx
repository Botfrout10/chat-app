import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { useChannels, useMembers, useWorkspaces } from "@/hooks/queries";
import { usePullToPalette } from "@/hooks/usePullToPalette";
import { channelTitle, initials, isDmLike } from "@/lib/channelTitle";
import { useChatStore } from "@/stores/chat";
import { useUiStore } from "@/stores/ui";
import { useTheme } from "@/theme/useTheme";
import type { Channel, LlmConnection } from "@/types";

export default function Chats() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<"workspace" | "dm" | "channel" | null>(null);
  const [newWsName, setNewWsName] = useState("");
  const [wsError, setWsError] = useState<string | null>(null);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const uiDialog = useUiStore((s) => s.dialog);
  const closeUiDialog = useUiStore((s) => s.closeDialog);

  // bridge palette dialog → local modal (keeps existing modal UI)
  useEffect(() => {
    if (uiDialog === "createWorkspace") setModal("workspace");
    else if (uiDialog === "createChannel") setModal("channel");
    else if (uiDialog === "newDm" || uiDialog === "inviteMember") setModal("dm");
  }, [uiDialog]);

  function closeModal() {
    setModal(null);
    closeUiDialog();
  }

  const createWsMutation = useMutation({
    mutationFn: () => api.createWorkspace(newWsName.trim()),
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setActiveWorkspace(ws.id);
      setNewWsName("");
      setModal(null);
      useUiStore.getState().closeDialog();
    },
    onError: (e) => setWsError(e instanceof Error ? e.message : "Failed to create workspace"),
  });

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

  const atTopRef = useRef(true);
  const { panHandlers: dragHandlers, pullDistance: handlePull } = usePullToPalette({
    enabled: !paletteOpen,
    atTopRef,
    onOpen: () => setPaletteOpen(true),
    threshold: 64,
    ignoreAtTop: true,
  });
  const { panHandlers: listHandlers, pullDistance: listPull } = usePullToPalette({
    enabled: !paletteOpen,
    atTopRef,
    onOpen: () => setPaletteOpen(true),
    threshold: 96,
    ignoreAtTop: false,
  });
  const pullDistance = Math.max(handlePull, listPull);

  const channels = channelsQuery.data ?? [];
  const channelList = channels.filter((c) => !isDmLike(c));
  const dmList = channels.filter(isDmLike);

  // AI model connections
  const llmQuery = useQuery({
    queryKey: ["llm-connections"],
    queryFn: () => api.llmConnections(),
    enabled: !!activeWorkspaceId,
  });
  const [llmOpening, setLlmOpening] = useState<string | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  async function openLlmDm(conn: LlmConnection) {
    if (!activeWorkspaceId) return;
    setLlmOpening(conn.id);
    setLlmError(null);
    try {
      const ch = await api.createLlmDm(conn.id, activeWorkspaceId);
      await queryClient.invalidateQueries({ queryKey: ["channels", activeWorkspaceId] });
      router.push({ pathname: "/channel/[id]", params: { id: ch.id, name: conn.label, type: "dm" } });
    } catch (e) {
      setLlmError(e instanceof Error ? e.message : "Failed to open model chat");
    } finally {
      setLlmOpening(null);
    }
  }

  const activeWs = workspacesQuery.data?.find((w) => w.id === activeWorkspaceId);

  function openChannel(c: Channel) {
    router.push({
      pathname: "/channel/[id]",
      params: {
        id: c.id,
        name: channelTitle(c),
        type: c.type,
        peer: !Array.isArray(c.dmPeer) && c.dmPeer ? c.dmPeer.id : "",
      },
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
    closeModal();
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
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open command palette"
            onPress={() => setPaletteOpen(true)}
            style={[styles.headerBtn, { backgroundColor: t.muted }]}
          >
            <Ionicons name="search" size={18} color={t.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setModal("workspace")}
            style={[styles.headerBtn, { backgroundColor: t.muted }]}
          >
            <Ionicons name="swap-horizontal" size={18} color={t.primary} />
          </Pressable>
        </View>
      </View>

      {/* drag handle for palette — pull here, list pull stays as refresh */}
      <View {...dragHandlers} style={styles.dragHandle}>
        <View style={[styles.dragPill, { backgroundColor: t.border }]} />
        {pullDistance > 0 && (
          <View style={[styles.pullHint, { backgroundColor: t.muted, borderColor: t.border }]}>
            <Ionicons name={pullDistance > 56 ? "sparkles" : "chevron-down"} size={14} color={t.primary} />
            <Text style={[styles.pullHintText, { color: t.primary }]}>
              {pullDistance > 56 ? "Release to open palette" : "Pull down for palette"}
            </Text>
          </View>
        )}
      </View>

      {(channelsQuery.isPending || workspacesQuery.isPending) && (
        <ActivityIndicator style={{ marginTop: 24 }} color={t.primary} />
      )}

      <View style={{ flex: 1 }} {...listHandlers}>
        <FlatList
          onScroll={(e) => {
            atTopRef.current = e.nativeEvent.contentOffset.y <= 4;
          }}
          scrollEventThrottle={16}
          data={[{ kind: "channels" as const }, { kind: "models" as const }, { kind: "dms" as const }]}
          keyExtractor={(item) => item.kind}
          renderItem={({ item }) =>
          item.kind === "channels" ? (
            <Section
              title={`Channels${channelList.length ? ` — ${channelList.length}` : ""}`}
              actionLabel="New"
              onAction={() => setModal("channel")}
            >
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
          ) : item.kind === "models" ? (
            <Section title="AI models">
              {(llmQuery.data ?? []).map((conn) => (
                <Pressable
                  key={conn.id}
                  disabled={llmOpening === conn.id}
                  onPress={() => openLlmDm(conn)}
                  style={({ pressed }) => [styles.row, { opacity: pressed || llmOpening === conn.id ? 0.6 : 1 }]}
                >
                  <View style={[rowStyles.hashWrap, { backgroundColor: t.accent100 }]}>
                    <Text style={{ color: t.accent700, fontWeight: "700", fontSize: 14 }}>✦</Text>
                  </View>
                  <Text style={[styles.rowTitle, { color: t.foreground, flex: 1 }]} numberOfLines={1}>
                    {conn.label}
                  </Text>
                  {llmOpening === conn.id ? (
                    <ActivityIndicator color={t.primary} size="small" />
                  ) : (
                    <View
                      style={[
                        rowStyles.dot,
                        {
                          backgroundColor:
                            conn.status === "ok" ? t.success : conn.status === "error" ? t.destructive : t.warning,
                          borderColor: t.background,
                        },
                      ]}
                    />
                  )}
                </Pressable>
              ))}
              {!llmQuery.isPending && !(llmQuery.data ?? []).length && (
                <Empty text="No models connected — connect one on web" />
              )}
              {!!llmError && (
                <Text style={{ color: t.destructive, fontSize: 12, paddingHorizontal: 16 }}>{llmError}</Text>
              )}
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
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      </View>

      {/* workspace switcher */}
      <Modal
        visible={modal === "workspace"}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeModal}>
          <View style={[styles.modalCard, { backgroundColor: t.card }]}>
            <Text style={[styles.modalTitle, { color: t.foreground }]}>Workspaces</Text>
            {(workspacesQuery.data ?? []).map((w) => (
              <Pressable
                key={w.id}
                onPress={() => {
                  setActiveWorkspace(w.id);
                  closeModal();
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

            <View style={{ borderTopWidth: 1, borderTopColor: t.border, paddingTop: 10, marginTop: 4, gap: 8 }}>
              <Text style={{ color: t.mutedForeground, fontSize: 12, fontWeight: "600" }}>CREATE NEW</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground, flex: 1 }]}
                  placeholder="Workspace name"
                  placeholderTextColor={t.mutedForeground}
                  value={newWsName}
                  onChangeText={setNewWsName}
                  onSubmitEditing={() => newWsName.trim().length >= 2 && createWsMutation.mutate()}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={createWsMutation.isPending || newWsName.trim().length < 2}
                  onPress={() => createWsMutation.mutate()}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: t.primary, paddingHorizontal: 16, paddingVertical: 0, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  {createWsMutation.isPending ? (
                    <ActivityIndicator color={t.primaryForeground} size="small" />
                  ) : (
                    <Ionicons name="add" size={20} color={t.primaryForeground} />
                  )}
                </Pressable>
              </View>
              {!!wsError && <Text style={{ color: t.destructive, fontSize: 12 }}>{wsError}</Text>}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* new-DM member picker */}
      <DmPickerModal
        visible={modal === "dm"}
        workspaceId={activeWorkspaceId}
        onClose={closeModal}
        onCreated={handleDmCreated}
      />

      {/* new channel */}
      <CreateChannelModal
        visible={modal === "channel"}
        workspaceId={activeWorkspaceId}
        onClose={closeModal}
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
  const queryClient = useQueryClient();
  const membersQuery = useMembers(visible ? workspaceId : null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState("");

  const inviteMutation = useMutation({
    mutationFn: () => api.addMember(workspaceId!, invite.trim()),
    onSuccess: (added) => {
      setInvite("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["members", workspaceId] });
      void added;
    },
    onError: (e) => {
      const raw = e instanceof Error ? e.message : "Failed to add member";
      // not a registered user — fall back to email invite
      if (/USER_NOT_FOUND|No registered user/i.test(raw)) {
        inviteMutation.reset();
        api.invite(workspaceId!, invite.trim(), "member")
          .then(() => {
            setInvite("");
            setError(null);
            queryClient.invalidateQueries({ queryKey: ["members", workspaceId] });
          })
          .catch((e2) => setError(e2 instanceof Error ? e2.message.slice(0, 160) : "Failed to send invite"));
        return;
      }
      setError(raw.slice(0, 160));
    },
  });

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
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground, flex: 1 }]}
              placeholder="Add by name or email…"
              placeholderTextColor={t.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              value={invite}
              onChangeText={setInvite}
              onSubmitEditing={() => invite.trim() && inviteMutation.mutate()}
            />
            <Pressable
              accessibilityRole="button"
              disabled={inviteMutation.isPending || !invite.trim()}
              onPress={() => inviteMutation.mutate()}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: t.primary, paddingHorizontal: 14, paddingVertical: 0, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              {inviteMutation.isPending ? (
                <ActivityIndicator color={t.primaryForeground} size="small" />
              ) : (
                <Ionicons name="person-add-outline" size={18} color={t.primaryForeground} />
              )}
            </Pressable>
          </View>
          {!!error && <Text style={{ color: t.destructive, fontSize: 12 }}>{error}</Text>}
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

function CreateChannelModal({
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
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createChannel(workspaceId!, {
        name: name.trim().toLowerCase().replace(/\s+/g, "-"),
        type: isPrivate ? "private" : "public",
      }),
    onSuccess: (channel) => {
      setName("");
      setIsPrivate(false);
      void onCreated(channel.id, channelTitle(channel));
    },
    onError: (e) => {
      const raw = e instanceof Error ? e.message : "Failed to create channel";
      setError(/unique|duplicate/i.test(raw) ? "A channel with this name already exists" : raw);
    },
  });

  function submit() {
    setError(null);
    if (!workspaceId) { setError("Select a workspace first"); return; }
    createMutation.mutate();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.modalCard, { backgroundColor: t.card }]}>
          <Text style={[styles.modalTitle, { color: t.foreground }]}>New channel</Text>
          <TextInput
            style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground }]}
            placeholder="e.g. design-crit (a-z, 0-9, -)"
            placeholderTextColor={t.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            value={name}
            onChangeText={setName}
            onSubmitEditing={submit}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setIsPrivate((v) => !v)}
            style={({ pressed }) => [
              styles.wsRow,
              { borderWidth: 1, borderColor: t.border, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons name={isPrivate ? "lock-closed" : "globe-outline"} size={18} color={t.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: t.foreground }]}>{isPrivate ? "🔒 Private" : "🌐 Public"}</Text>
              <Text style={{ color: t.mutedForeground, fontSize: 12 }}>
                {isPrivate ? "Invite only — hidden from non-members" : "Everyone in the workspace can join"}
              </Text>
            </View>
            <Ionicons
              name={isPrivate ? "checkbox" : "square-outline"}
              size={20}
              color={isPrivate ? t.primary : t.mutedForeground}
            />
          </Pressable>
          {!!error && <Text style={{ color: t.destructive, fontSize: 13 }}>{error}</Text>}
          <Pressable
            accessibilityRole="button"
            disabled={createMutation.isPending || name.trim().length < 2}
            onPress={submit}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: t.primary, opacity: pressed || createMutation.isPending ? 0.8 : 1 },
            ]}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={t.primaryForeground} size="small" />
            ) : (
              <Text style={[styles.primaryBtnText, { color: t.primaryForeground }]}>Create channel</Text>
            )}
          </Pressable>
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
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  primaryBtn: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    minWidth: 42,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "700" },
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
  dragHandle: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 6,
    paddingBottom: 2,
    gap: 4,
  },
  dragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.6,
  },
  pullHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 2,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "center",
  },
  pullHintText: { fontSize: 12, fontWeight: "600" },
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

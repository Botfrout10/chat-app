import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { useChannels, useMe, useMembers, useWorkspaces } from "@/hooks/queries";
import { channelTitle, isDmLike } from "@/lib/channelTitle";
import { useSession } from "@/lib/session";
import { useChatStore } from "@/stores/chat";
import { useUiStore } from "@/stores/ui";
import { useTheme } from "@/theme/useTheme";
import type { Channel, LlmConnection, Member } from "@/types";

type PaletteItem = {
  key: string;
  label: string;
  sub?: string;
  icon: string;
  onPress: () => void;
  filterValue: string;
};

export function CommandPalette() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signOut } = useSession();

  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const openDialog = useUiStore((s) => s.openDialog);

  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useChatStore((s) => s.setActiveWorkspace);

  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    if (!paletteOpen) {
      setQuery("");
      setDebouncedQ("");
    }
  }, [paletteOpen]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const workspacesQuery = useWorkspaces();
  const channelsQuery = useChannels(paletteOpen ? activeWorkspaceId : null);
  const membersQuery = useMembers(paletteOpen ? activeWorkspaceId : null);
  const meQuery = useMe(paletteOpen);
  const llmQuery = useQuery({
    queryKey: ["llm-connections"],
    queryFn: () => api.llmConnections().catch(() => [] as LlmConnection[]),
    enabled: paletteOpen,
  });
  const searchQuery = useQuery({
    queryKey: ["palette-search", debouncedQ],
    queryFn: () => api.search(debouncedQ).catch(() => []),
    enabled: paletteOpen && debouncedQ.length >= 2,
  });

  const workspaces = workspacesQuery.data ?? [];
  const channels: Channel[] = (channelsQuery.data as Channel[] | undefined) ?? [];
  const members: Member[] = (membersQuery.data as Member[] | undefined) ?? [];
  const llmConnections: LlmConnection[] = (llmQuery.data as LlmConnection[] | undefined) ?? [];
  const searchRes = (searchQuery.data as any[] | undefined) ?? [];

  const meId = (meQuery.data as any)?.id as string | undefined;

  function close() {
    setPaletteOpen(false);
  }

  function goChannel(channelId: string) {
    close();
    // small delay so modal close animation starts before navigation
    setTimeout(() => {
      const ch = channels.find((c) => c.id === channelId);
      const title = ch ? channelTitle(ch) : "";
      const peer = !Array.isArray(ch?.dmPeer) && ch?.dmPeer ? (ch.dmPeer as any).id : "";
      router.push({
        pathname: "/channel/[id]",
        params: { id: channelId, name: title, type: ch?.type ?? "public", peer },
      });
    }, 80);
  }

  async function handleOpenDm(member: Member) {
    if (!activeWorkspaceId) return;
    close();
    try {
      const ch = await api.findOrCreateDm(activeWorkspaceId, member.id);
      await queryClient.invalidateQueries({ queryKey: ["channels", activeWorkspaceId] });
      router.push({
        pathname: "/channel/[id]",
        params: { id: ch.id, name: member.name, type: "dm" },
      });
    } catch {
      // silently ignore — palette closed, user can retry via normal UI
    }
  }

  async function handleOpenLlm(conn: LlmConnection) {
    if (!activeWorkspaceId) return;
    close();
    try {
      const ch = await api.createLlmDm(conn.id, activeWorkspaceId);
      await queryClient.invalidateQueries({ queryKey: ["channels", activeWorkspaceId] });
      router.push({ pathname: "/channel/[id]", params: { id: ch.id, name: conn.label, type: "dm" } });
    } catch {
      // ignore
    }
  }

  function handleSwitchWorkspace(id: string) {
    setActiveWorkspace(id);
    close();
  }

  async function handleSignOut() {
    close();
    try {
      await signOut();
    } catch {
      // ignore
    }
  }

  const qLower = debouncedQ.toLowerCase() || query.trim().toLowerCase();
  const hasQuery = qLower.length > 0;

  const channelItems: PaletteItem[] = useMemo(() => {
    const list = channels.filter((c) => !isDmLike(c));
    const filtered = hasQuery ? list.filter((c) => `channel ${c.name}`.toLowerCase().includes(qLower)) : list;
    return filtered.map((c) => ({
      key: `channel-${c.id}`,
      label: `# ${c.name}`,
      sub: c.type === "private" ? "private" : undefined,
      icon: c.type === "private" ? "lock-closed" : "chatbubble-outline",
      filterValue: `channel ${c.name}`,
      onPress: () => goChannel(c.id),
    }));
  }, [channels, hasQuery, qLower]);

  const dmItems: PaletteItem[] = useMemo(() => {
    const candidates = members.filter((m) => m.id !== meId);
    const filtered = hasQuery
      ? candidates.filter((m) => `dm ${m.name} ${m.email ?? ""}`.toLowerCase().includes(qLower))
      : candidates;
    return filtered.map((m) => {
      const existing = channels.find((c) => isDmLike(c) && !Array.isArray(c.dmPeer) && (c.dmPeer as any)?.id === m.id);
      return {
        key: `dm-${m.id}`,
        label: m.name,
        sub: existing ? "open chat" : m.email ?? "",
        icon: "at",
        filterValue: `dm ${m.name} ${m.email ?? ""}`,
        onPress: () => handleOpenDm(m),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, meId, channels, hasQuery, qLower]);

  const llmItems: PaletteItem[] = useMemo(() => {
    const filtered = hasQuery ? llmConnections.filter((c) => `model ${c.label}`.toLowerCase().includes(qLower)) : llmConnections;
    return filtered.map((c) => ({
      key: `model-${c.id}`,
      label: c.label,
      sub: c.mentionName ? `@${c.mentionName}` : c.modelId,
      icon: "sparkles",
      filterValue: `model ${c.label}`,
      onPress: () => handleOpenLlm(c),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmConnections, hasQuery, qLower]);

  const messageItems: PaletteItem[] = useMemo(() => {
    if (!searchRes.length || debouncedQ.length < 2) return [];
    const slice = searchRes.slice(0, 8);
    return slice.map((r: any) => ({
      key: `msg-${r.id}`,
      label: (r.content as string)?.slice(0, 80) || "message",
      sub: r.channel?.name ? `#${r.channel.name}` : r.channelId ? `#${r.channelId.slice(0, 6)}` : undefined,
      icon: "search",
      filterValue: `message ${r.content}`,
      onPress: () => goChannel(r.channelId ?? r.channel?.id),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRes, debouncedQ]);

  const actionItems: PaletteItem[] = useMemo(() => {
    const actions: PaletteItem[] = [
      {
        key: "act-create-ws",
        label: "Create workspace",
        icon: "albums-outline",
        filterValue: "create workspace new",
        onPress: () => {
          close();
          setTimeout(() => openDialog("createWorkspace"), 100);
        },
      },
      {
        key: "act-create-ch",
        label: "Create channel",
        icon: "add-circle-outline",
        filterValue: "create channel new",
        onPress: () => {
          close();
          setTimeout(() => openDialog("createChannel"), 100);
        },
      },
      {
        key: "act-new-dm",
        label: "New direct message",
        icon: "chatbubble-ellipses-outline",
        filterValue: "new direct message dm",
        onPress: () => {
          close();
          setTimeout(() => openDialog("newDm"), 100);
        },
      },
      {
        key: "act-invite",
        label: "Invite members",
        icon: "person-add-outline",
        filterValue: "invite add member people",
        onPress: () => {
          close();
          setTimeout(() => openDialog("inviteMember"), 100);
        },
      },
      {
        key: "act-llm",
        label: "Manage AI models",
        icon: "hardware-chip-outline",
        filterValue: "connect ai model llm manage",
        onPress: () => {
          close();
          setTimeout(() => openDialog("llmManager"), 100);
        },
      },
    ];
    if (!hasQuery) return actions;
    return actions.filter((a) => a.filterValue.includes(qLower));
  }, [hasQuery, qLower, openDialog]);

  const workspaceItems: PaletteItem[] = useMemo(() => {
    if (workspaces.length <= 1) return [];
    const filtered = hasQuery ? workspaces.filter((w) => `workspace ${w.name}`.toLowerCase().includes(qLower)) : workspaces;
    return filtered.map((w) => ({
      key: `ws-${w.id}`,
      label: w.name,
      sub: w.id === activeWorkspaceId ? "current" : undefined,
      icon: "business-outline",
      filterValue: `workspace ${w.name}`,
      onPress: () => handleSwitchWorkspace(w.id),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, hasQuery, qLower, activeWorkspaceId]);

  const sections: { title: string; data: PaletteItem[] }[] = useMemo(() => {
    const s: { title: string; data: PaletteItem[] }[] = [];
    if (channelItems.length) s.push({ title: "Channels", data: channelItems });
    if (dmItems.length) s.push({ title: "Direct messages", data: dmItems });
    if (llmItems.length) s.push({ title: "AI models", data: llmItems });
    if (messageItems.length) s.push({ title: `Messages matching “${debouncedQ}”`, data: messageItems });
    if (actionItems.length) s.push({ title: "Actions", data: actionItems });
    if (workspaceItems.length) s.push({ title: "Switch workspace", data: workspaceItems });
    s.push({
      title: "Account",
      data: [
        {
          key: "act-signout",
          label: "Sign out",
          icon: "log-out-outline",
          filterValue: "sign out logout",
          onPress: () => void handleSignOut(),
        },
      ],
    });
    // filter account if query doesn't match? keep visible unless query & no match
    if (hasQuery && !("sign out logout".includes(qLower))) {
      // hide account if query doesn't match sign out
      const last = s[s.length - 1];
      if (last.title === "Account" && !last.data[0].filterValue.includes(qLower)) {
        s.pop();
      }
    }
    return s;
  }, [channelItems, dmItems, llmItems, messageItems, actionItems, workspaceItems, hasQuery, qLower, debouncedQ]);

  const totalResults = sections.reduce((acc, sec) => acc + sec.data.length, 0);

  return (
    <Modal visible={paletteOpen} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <SafeAreaView style={styles.safe} edges={["top"]} pointerEvents="box-none">
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]} pointerEvents="auto">
            {/* handle */}
            <View style={[styles.handle, { backgroundColor: t.border }]} />
            <View style={[styles.searchRow, { borderColor: t.inputBorder, backgroundColor: t.input }]}>
              <Ionicons name="search" size={18} color={t.mutedForeground} />
              <TextInput
                style={[styles.input, { color: t.foreground }]}
                placeholder="Search channels, people, messages — or run a command…"
                placeholderTextColor={t.mutedForeground}
                value={query}
                onChangeText={setQuery}
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={t.mutedForeground} />
                </Pressable>
              )}
            </View>

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {searchQuery.isFetching && debouncedQ.length >= 2 && (
                <View style={{ padding: 12, alignItems: "center" }}>
                  <ActivityIndicator color={t.primary} size="small" />
                </View>
              )}
              {sections.map((sec) => (
                <View key={sec.title} style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: t.mutedForeground }]}>{sec.title.toUpperCase()}</Text>
                  {sec.data.map((item) => (
                    <Pressable
                      key={item.key}
                      onPress={item.onPress}
                      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.muted : "transparent" }]}
                    >
                      <View style={[styles.iconWrap, { backgroundColor: t.muted }]}>
                        <Ionicons name={item.icon as any} size={16} color={t.foreground} />
                      </View>
                      <Text style={[styles.rowLabel, { color: t.foreground }]} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {item.sub ? (
                        <Text style={[styles.rowSub, { color: t.mutedForeground }]} numberOfLines={1}>
                          {item.sub}
                        </Text>
                      ) : null}
                      <Ionicons name="chevron-forward" size={14} color={t.mutedForeground} style={{ marginLeft: 6 }} />
                    </Pressable>
                  ))}
                </View>
              ))}
              {totalResults === 0 && !searchQuery.isFetching && (
                <Text style={[styles.empty, { color: t.mutedForeground }]}>No results found.</Text>
              )}
              <View style={[styles.footer, { borderTopColor: t.border }]}>
                <Text style={{ color: t.mutedForeground, fontSize: 11 }}>
                  Pull down from top to open • Tap outside to close
                </Text>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#00000066",
    justifyContent: "flex-start",
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  safe: { flex: 1 },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    maxHeight: "86%",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 4,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },
  list: { flexGrow: 0 },
  section: { paddingTop: 8, paddingBottom: 4 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, paddingHorizontal: 16, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 8,
    borderRadius: 10,
  },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "500" },
  rowSub: { fontSize: 12, maxWidth: 120, textAlign: "right" },
  empty: { textAlign: "center", padding: 24, fontSize: 13 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8, padding: 10, alignItems: "center" },
});

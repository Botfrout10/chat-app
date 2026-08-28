import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { ActionSheet, QuickReactions, type Action } from "@/components/chat/ActionSheet";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageComposer, type ComposerState } from "@/components/chat/MessageComposer";
import { joinChannelRoom, leaveChannelRoom } from "@/hooks/useChatEvents";
import { useChannelMembers, useMe, useMembers, useMessages } from "@/hooks/queries";
import { useRequireSession } from "@/hooks/useRequireSession";
import { useSession } from "@/lib/session";
import { useChatStore } from "@/stores/chat";
import { pickDocument, pickImage, uploadAttachment, type UploadedMeta } from "@/lib/upload";
import { useTheme } from "@/theme/useTheme";
import type { MessagesPage, Message } from "@/types";
import { newNonce } from "@/lib/newNonce";

/** Stable empty array — selectors must return cached values or React loops (getSnapshot). */
const NO_TYPING: string[] = [];

export default function ChannelView() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string; name?: string; type?: string; peer?: string }>();
  const channelId = params.id;
  const insets = useSafeAreaInsets();

  const { token } = useSession();
  const meQuery = useMe(!!token);
  const me = meQuery.data ?? null;

  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);

  const blocker = useRequireSession();

  const messagesQuery = useMessages(channelId);
  const typingUsers = useChatStore((s) => s.typingUsers[channelId] ?? NO_TYPING);
  const presence = useChatStore((s) => s.presence);
  const llmStream = useChatStore((s) => s.llmStreams[channelId]);
  const llmQuery = useQuery({
    queryKey: ["llm-connections"],
    queryFn: () => api.llmConnections(),
    enabled: !!channelId,
  });
  const llmLabel = llmQuery.data?.find((c) => c.id === llmStream?.connectionId)?.label;

  // member name set drives @mention chip highlighting (me vs known vs unknown)
  const membersQuery = useMembers(activeWorkspaceId);
  const memberTokens = useMemo(
    () => new Set((membersQuery.data ?? []).map((m) => m.name.toLowerCase())),
    [membersQuery.data],
  );

  // seen-by read receipts: members whose read cursor sits on a given message
  const channelMembersQuery = useChannelMembers(channelId);
  const readByMap = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>();
    for (const r of channelMembersQuery.data ?? []) {
      if (!r.lastReadMessageId || r.id === me?.id) continue;
      const arr = m.get(r.lastReadMessageId);
      if (arr) arr.push({ id: r.id, name: r.name });
      else m.set(r.lastReadMessageId, [{ id: r.id, name: r.name }]);
    }
    return m;
  }, [channelMembersQuery.data, me?.id]);

  // AI channel detection (for read receipts): bot user in members or llm dm
  const botIdToConn = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of (llmQuery.data as any[]) ?? []) if (c.botUserId) m.set(c.botUserId, c.id);
    return m;
  }, [llmQuery.data]);
  const llmConnectionIdForChannel = useMemo(() => {
    const members = (channelMembersQuery.data as any[]) ?? [];
    for (const mem of members) if (botIdToConn.has(mem.id)) return botIdToConn.get(mem.id)!;
    return null;
  }, [channelMembersQuery.data, botIdToConn]);
  const isAiChannel = !!llmConnectionIdForChannel;
  const isDmLike = params.type === "dm" || params.type === "group";

  // AI reachability — once on open (no polling); updated on send failure / socket error
  const llmStatusQuery = useQuery({
    queryKey: ["llm-status", llmConnectionIdForChannel],
    queryFn: () => api.llmConnectionStatus(llmConnectionIdForChannel!),
    enabled: isAiChannel && !!llmConnectionIdForChannel,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: "always",
  });
  const providerReachable = (llmStatusQuery.data as any)?.providerReachable as boolean | null | undefined;
  const statusConn: any = (llmStatusQuery.data as any)?.connection ?? null;
  const modelId = (llmQuery.data as any[])?.find((c: any) => c.id === llmConnectionIdForChannel)?.modelId as string | undefined;
  const providerModels = (llmStatusQuery.data as any)?.providerModels as string[] | null | undefined;
  const isAiChecking = isAiChannel && llmStatusQuery.isFetching;
  const isAiOffline =
    isAiChannel &&
    !isAiChecking &&
    (llmStatusQuery.isError || providerReachable === false || statusConn?.status === "error" || (providerModels != null && modelId != null && !providerModels.includes(modelId)));
  const isAiOnline = isAiChannel && !isAiChecking && !isAiOffline && providerReachable === true;
  const [showOnlineBanner, setShowOnlineBanner] = useState(false);
  useEffect(() => {
    if (!isAiOnline) {
      setShowOnlineBanner(false);
      return;
    }
    setShowOnlineBanner(true);
    const t = setTimeout(() => setShowOnlineBanner(false), 3000);
    return () => clearTimeout(t);
  }, [isAiOnline, llmConnectionIdForChannel]);

  const [composerState, setComposerState] = useState<ComposerState>({ kind: "idle" });
  const [sheetFor, setSheetFor] = useState<Message | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, setPending] = useState<UploadedMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachSheet, setAttachSheet] = useState(false);
  const [showStreamThinking, setShowStreamThinking] = useState(false);

  // join/leave the socket room for live updates
  useEffect(() => {
    if (!channelId) return;
    joinChannelRoom(channelId);
    return () => leaveChannelRoom(channelId);
  }, [channelId]);

  const flat = useMemo(
    () => (messagesQuery.data ? flattenPages(messagesQuery.data) : []),
    [messagesQuery.data],
  );

  // mark read as new messages arrive (skip optimistic temps)
  useEffect(() => {
    const latest = flat.find((m) => !m.id.startsWith("temp-"));
    if (latest) void api.markRead(channelId, latest.id).catch(() => {});
  }, [channelId, flat]);

  const sendMutation = useMutation({
    mutationFn: async ({
      content,
      parentId,
      attachments,
    }: {
      content: string;
      parentId?: string;
      attachments?: UploadedMeta[];
    }) => {
      const nonce = newNonce();
      const optimistic: Message = {
        id: `temp-${nonce}`,
        channelId,
        senderId: me?.id ?? "me",
        parentId: parentId ?? null,
        content,
        nonce,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        sender: me,
        attachments: [],
        reactions: [],
      };
      insertOptimistic(channelId, queryClient, optimistic);
      try {
        return await api.sendMessage(channelId, {
          content,
          parentId: parentId ?? null,
          nonce,
          attachments: attachments?.length ? attachments : undefined,
        });
      } catch (e) {
        removeMessage(channelId, queryClient, optimistic.id);
        throw e;
      }
    },
    onSuccess: (real) => {
      // replace optimistic entry with the persisted one (also covers socket echo)
      replaceById(channelId, queryClient, real.nonce ?? null, real);
    },
    onError: (e) => setSendError(e instanceof Error ? e.message : "Failed to send"),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => api.editMessage(id, content),
    onSuccess: () => setComposerState({ kind: "idle" }),
    onError: (e) => setSendError(e instanceof Error ? e.message : "Failed to edit"),
  });

  function react(messageId: string, emoji: string, currentlyMine: boolean) {
    const call = currentlyMine ? api.unreact(messageId, emoji) : api.react(messageId, emoji);
    void call.catch(() => {});
  }

  async function handleAttach(kind: "image" | "file") {
    setAttachSheet(false);
    setUploading(true);
    try {
      const picked = kind === "image" ? await pickImage() : await pickDocument();
      if (!picked) return;
      const meta = await uploadAttachment(picked);
      setPending((p) => [...p, meta]);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const sheetActions: Action[] = useMemo(() => {
    if (!sheetFor) return [];
    const own = sheetFor.senderId === me?.id;
    const actions: Action[] = [];
    actions.push({
      key: "thread",
      label: "View thread",
      onPress: () =>
        router.push({
          pathname: "/thread/[id]",
          params: {
            id: sheetFor.id,
            channelId,
            workspaceId: activeWorkspaceId,
            name: params.name ?? "",
            parent: JSON.stringify(sheetFor),
          },
        }),
    });
    actions.push(
      {
        key: "reply",
        label: "Reply",
        onPress: () =>
          setComposerState({
            kind: "reply",
            parentId: sheetFor.id,
            parentPreview: sheetFor.content.slice(0, 80),
          }),
      },
      ...(own && !sheetFor.deletedAt
        ? [
            {
              key: "edit",
              label: "Edit message",
              onPress: () =>
                setComposerState({ kind: "edit", messageId: sheetFor.id, initial: sheetFor.content }),
            },
            {
              key: "delete",
              label: "Delete message",
              destructive: true,
              onPress: () => {
                void api.deleteMessage(sheetFor.id).catch(() => {});
              },
            },
          ]
        : []),
    );
    return actions;
  }, [sheetFor, me?.id, router, params.name]);

  // Session guard — must stay BELOW all hooks so the hook order is stable
  // whether or not the blocker short-circuits the render.
  if (blocker) return blocker;

  // Route arrived without an id (bad deep link / notification) — never render
  // a live composer that would POST to /api/channels/undefined/messages.
  if (!channelId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
        <View style={styles.missingWrap}>
          <Ionicons name="chatbubble-outline" size={36} color={t.border} />
          <Text style={{ color: t.mutedForeground, marginTop: 8 }}>Conversation not found</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/chats"))}
            style={({ pressed }) => [styles.missingBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ color: t.primary, fontWeight: "600" }}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const typingLabel =
    typingUsers.length === 0
      ? ""
      : typingUsers.length === 1
        ? "someone is typing…"
        : `${typingUsers.length} people are typing…`;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={["top", "bottom"]}>
      {/* header */}
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={t.foreground} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text style={[styles.title, { color: t.foreground }]} numberOfLines={1}>
            {(params.type === "dm" || params.type === "group") ? params.name : `# ${params.name ?? ""}`}
          </Text>
          {params.peer && presence[params.peer] === "online" ? (
            <Text style={{ fontSize: 11, color: t.success }}>online</Text>
          ) : null}
        </View>
      </View>

      {isAiChannel && (isAiChecking || isAiOffline || (isAiOnline && showOnlineBanner)) && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: t.border,
            backgroundColor: isAiChecking ? t.warning + "18" : isAiOffline ? t.destructive + "12" : t.success + "12",
          }}
        >
          {isAiChecking ? (
            <>
              <ActivityIndicator size="small" color={t.mutedForeground} />
              <Text style={{ color: t.mutedForeground, fontSize: 12 }}>Checking {modelId ?? "model"} reachability…</Text>
            </>
          ) : isAiOffline ? (
            <>
              <Ionicons name="cloud-offline-outline" size={14} color={t.destructive} />
              <Text style={{ color: t.destructive, fontSize: 12, flex: 1 }} numberOfLines={1}>
                Model offline{statusConn?.lastError ? ` — ${String(statusConn.lastError).slice(0, 80)}` : providerReachable === false ? " — provider unreachable" : " — not reachable"}
              </Text>
              <Pressable onPress={() => llmStatusQuery.refetch()} hitSlop={6}>
                <Ionicons name="refresh" size={16} color={t.destructive} />
              </Pressable>
            </>
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={14} color={t.success} />
              <Text style={{ color: t.success, fontSize: 12 }}>{modelId ?? "Model"} reachable</Text>
            </>
          )}
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
        {messagesQuery.isPending ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={t.primary} />
        ) : messagesQuery.isError ? (
          <Text style={{ color: t.destructive, padding: 16, textAlign: "center" }}>
            Failed to load messages
          </Text>
        ) : (
          <FlatList
            data={flat}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={({ item, index }) => {
              // in an inverted list, the visually previous message is at index + 1
              const prev = flat[index + 1];
              const firstOfGroup =
                !prev ||
                prev.senderId !== item.senderId ||
                Math.abs(new Date(prev.createdAt).getTime() - new Date(item.createdAt).getTime()) >
                  5 * 60 * 1000;
              return (
                <MessageBubble
                  message={item}
                  me={me}
                  firstOfGroup={firstOfGroup}
                  memberTokens={memberTokens}
                  readBy={readByMap.get(item.id)}
                  hideReadReceipt={!isDmLike && !isAiChannel}
                  showChecks={isDmLike || isAiChannel}
                  onToggleReaction={(emoji, mine) => react(item.id, emoji, mine)}
                  onLongPress={setSheetFor}
                />
              );
            }}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) {
                void messagesQuery.fetchNextPage();
              }
            }}
            ListFooterComponent={
              messagesQuery.isFetchingNextPage ? (
                <ActivityIndicator style={{ marginVertical: 12 }} color={t.primary} />
              ) : null
            }
            contentContainerStyle={{ paddingVertical: 8 }}
          />
        )}

        {!!sendError && (
          <Pressable onPress={() => setSendError(null)}>
            <Text style={{ color: t.destructive, fontSize: 12, textAlign: "center", paddingVertical: 4 }}>
              {sendError} — tap to dismiss
            </Text>
          </Pressable>
        )}
        {!!llmStream && (
          <View style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
            <Text style={{ color: t.mutedForeground, fontSize: 12, fontWeight: "600" }}>
              <Ionicons name="sparkles" size={12} color={t.mutedForeground} /> {llmLabel ?? "AI"}{" "}
              {llmStream.text ? "is writing…" : llmStream.thinking ? "is thinking…" : "Loading model into GPU…"}
            </Text>
            {!!llmStream.thinking && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowStreamThinking((v) => !v)}
                hitSlop={6}
                style={{ paddingVertical: 2 }}
              >
                <Text style={{ color: t.mutedForeground, fontSize: 11, fontWeight: "600" }}>
                  {showStreamThinking ? "▾" : "▸"}{" "}
                  <Ionicons name="bulb-outline" size={11} color={t.mutedForeground} /> Thinking
                </Text>
              </Pressable>
            )}
            {showStreamThinking && !!llmStream.thinking && (
              <View style={{ backgroundColor: t.muted, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, marginTop: 2, maxHeight: 160 }}>
                <ScrollView>
                  <Text style={{ color: t.mutedForeground, fontSize: 12, lineHeight: 17 }} selectable>
                    {llmStream.thinking}
                  </Text>
                </ScrollView>
              </View>
            )}
            {!!llmStream.text && (
              <Text style={{ color: t.foreground, fontSize: 13, marginTop: 2 }} numberOfLines={6}>
                {llmStream.text}
              </Text>
            )}
          </View>
        )}
        {!!typingLabel && (
          <Text style={{ color: t.mutedForeground, fontSize: 12, paddingHorizontal: 14, paddingBottom: 2 }}>
            {typingLabel}
          </Text>
        )}

        <MessageComposer
          channelId={channelId}
          state={composerState}
          onStateCleared={() => setComposerState({ kind: "idle" })}
          onAttach={() => setAttachSheet(true)}
          uploading={uploading}
          pendingAttachments={pending.map((p) => p.filename)}
          onRemoveAttachment={(i) => setPending((p) => p.filter((_, j) => j !== i))}
          members={(membersQuery.data as any[]) ?? []}
          llmConnections={(llmQuery.data as any[]) ?? []}
          onSend={async (content) => {
            const isReply = composerState.kind === "reply";
            const parentId = isReply ? composerState.parentId : undefined;
            // if AI offline, don't insert message — pull back & keep status consistent
            if (isAiChannel) {
              if (isAiOffline) {
                setSendError(`Model offline — ${statusConn?.lastError ?? "provider not reachable"}`);
                return;
              }
              if (isAiChecking) {
                setSendError("Checking model reachability — please wait a moment and retry");
                return;
              }
              try {
                const fresh: any = await api.llmConnectionStatus(llmConnectionIdForChannel!);
                queryClient.setQueryData(["llm-status", llmConnectionIdForChannel], fresh);
                const reachable = fresh?.providerReachable;
                const models = fresh?.providerModels as string[] | null;
                const status = fresh?.connection?.status;
                const missing = models !== null && modelId != null && !models.includes(modelId);
                if (reachable === false || status === "error" || missing) {
                  setSendError(`Model offline — ${fresh?.connection?.lastError ?? "provider not reachable"}`);
                  return;
                }
              } catch (e: any) {
                setSendError(e instanceof Error ? e.message : "Model not reachable");
                return;
              }
            }
            await sendMutation.mutateAsync({
              content,
              parentId,
              attachments: pending,
            });
            setPending([]);
            if (isReply) setComposerState({ kind: "idle" });
          }}
          onEditSave={(id, content) => editMutation.mutateAsync({ id, content })}
        />
      </KeyboardAvoidingView>

      <ActionSheet
        visible={attachSheet}
        onClose={() => setAttachSheet(false)}
        actions={[
          { key: "image", label: "Photo library", onPress: () => void handleAttach("image") },
          { key: "file", label: "File…", onPress: () => void handleAttach("file") },
        ]}
      />

      <ActionSheet
        visible={!!sheetFor}
        onClose={() => setSheetFor(null)}
        header={
          sheetFor ? (
            <QuickReactions
              me={me}
              onPick={(emoji) => {
                if (!sheetFor) return;
                const mine = sheetFor.reactions.some((r) => r.userId === me?.id && r.emoji === emoji);
                react(sheetFor.id, emoji, mine);
                setSheetFor(null);
              }}
            />
          ) : undefined
        }
        actions={sheetActions}
      />
    </SafeAreaView>
  );
}

function flattenPages(data: InfiniteData<MessagesPage>): Message[] {
  return data.pages.flatMap((p) => p.messages);
}

function insertOptimistic(channelId: string, qc: ReturnType<typeof useQueryClient>, msg: Message) {
  qc.setQueryData<InfiniteData<MessagesPage>>(["messages", channelId], (data) => {
    if (!data) return data;
    const pages = [...data.pages];
    pages[0] = { ...pages[0], messages: [msg, ...pages[0].messages] };
    return { ...data, pages };
  });
}

function removeMessage(channelId: string, qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.setQueryData<InfiniteData<MessagesPage>>(["messages", channelId], (data) =>
    data && {
      ...data,
      pages: data.pages.map((p) => ({
        ...p,
        messages: p.messages.filter((m) => m.id !== id),
      })),
    },
  );
}

function replaceById(
  channelId: string,
  qc: ReturnType<typeof useQueryClient>,
  nonce: string | null,
  real: Message,
) {
  qc.setQueryData<InfiniteData<MessagesPage>>(["messages", channelId], (data) => {
    if (!data) return data;
    const pages = data.pages.map((p) => ({
      ...p,
      messages: p.messages.map((m) =>
        m.id === real.id || (!!nonce && m.nonce === nonce) ? real : m,
      ),
    }));
    return { ...data, pages };
  });
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  missingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  missingBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 20 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { marginLeft: 6, flex: 1 },
  title: { fontSize: 17, fontWeight: "700" },
});

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageComposer, type ComposerState } from "@/components/chat/MessageComposer";
import { joinChannelRoom, leaveChannelRoom } from "@/hooks/useChatEvents";
import { useMe, useReplies } from "@/hooks/queries";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";
import type { Message } from "@/types";
import { newNonce } from "@/lib/newNonce";

function parseParent(serialized?: string): Message | null {
  if (!serialized) return null;
  try {
    return JSON.parse(serialized) as Message;
  } catch {
    return null;
  }
}

export default function ThreadView() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    id: string;
    channelId?: string;
    parent?: string;
    name?: string;
  }>();
  const threadId = params.id ?? "";

  // parent is parsed once; params never change for a mounted route
  const [parent] = useState<Message | null>(() => parseParent(params.parent));

  const { token } = useSession();
  const meQuery = useMe(!!token);
  const me = meQuery.data ?? null;

  const repliesQuery = useReplies(threadId);
  const [sendError, setSendError] = useState<string | null>(null);
  const [composerState, setComposerState] = useState<ComposerState>({ kind: "idle" });

  // keep the channel room joined while the thread is open so replies arrive live
  const chanId = params.channelId;
  useEffect(() => {
    if (!chanId) return;
    joinChannelRoom(chanId);
    return () => leaveChannelRoom(chanId);
  }, [chanId]);

  function dedupe(list: Message[]): Message[] {
    const seen = new Set<string>();
    return list.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }

  const sendMutation = useMutation({
    mutationFn: async ({ content }: { content: string }) => {
      const nonce = newNonce();
      const optimistic: Message = {
        id: `temp-${nonce}`,
        channelId: params.channelId ?? "",
        senderId: me?.id ?? "me",
        parentId: threadId,
        content,
        nonce,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        sender: me,
        attachments: [],
        reactions: [],
      };
      queryClient.setQueryData<Message[]>(["replies", threadId], (old) => [
        ...(old ?? []),
        optimistic,
      ]);
      try {
        return await api.sendMessage(params.channelId ?? "", {
          content,
          parentId: threadId,
          nonce,
        });
      } catch (e) {
        queryClient.setQueryData<Message[]>(
          ["replies", threadId],
          (old) => (old ?? []).filter((m) => m.id !== optimistic.id),
        );
        throw e;
      }
    },
    onError: (e) => setSendError(e instanceof Error ? e.message : "Failed to reply"),
  });

  const rows = dedupe([...(repliesQuery.data ?? [])]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={t.foreground} />
        </Pressable>
        <View style={{ marginLeft: 8, flex: 1 }}>
          <Text style={[styles.title, { color: t.foreground }]}>Thread</Text>
          {!!params.name && (
            <Text style={{ fontSize: 11, color: t.mutedForeground }} numberOfLines={1}>
              {params.name}
            </Text>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {repliesQuery.isPending && !params.parent ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={t.primary} />
        ) : (
          <FlatList
            data={rows}
            inverted
            keyExtractor={(m) => m.id}
            ListFooterComponent={
              parent ? (
                <View style={[styles.parentWrap, { backgroundColor: t.muted }]}>
                  <MessageBubble message={parent} me={me} firstOfGroup />
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <MessageBubble message={item} me={me} firstOfGroup />
            )}
            contentContainerStyle={{ paddingVertical: 8 }}
          />
        )}

        {!!sendError && (
          <Pressable onPress={() => setSendError(null)}>
            <Text
              style={{ color: t.destructive, fontSize: 12, textAlign: "center", paddingVertical: 4 }}
            >
              {sendError} — tap to dismiss
            </Text>
          </Pressable>
        )}

        <MessageComposer
          channelId={params.channelId ?? ""}
          state={composerState}
          onStateCleared={() => setComposerState({ kind: "idle" })}
          onSend={(content) => sendMutation.mutateAsync({ content })}
          onEditSave={async () => {}}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: "700" },
  parentWrap: {
    marginHorizontal: 8,
    marginTop: 4,
    borderRadius: 14,
    paddingVertical: 2,
  },
});

import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useEffect } from "react";

import { getSocket } from "@/lib/socket";
import { useChatStore } from "@/stores/chat";
import type { MessagesPage, Message } from "@/types";

/**
 * Wires the socket singleton to the TanStack Query cache + zustand UI state.
 * Mount once at the root (inside SessionProvider). Channel rooms are joined by
 * <ChannelView> via joinChannelRoom/leaveChannelRoom.
 */
export function useChatEvents(enabled: boolean) {
  const queryClient = useQueryClient();
  const setTyping = useChatStore((s) => s.setTyping);
  const setPresence = useChatStore((s) => s.setPresence);
  const setLlmStream = useChatStore((s) => s.setLlmStream);

  useEffect(() => {
    if (!enabled) return;
    const socket = connectAndListen();
    return () => {
      socket.offAny(onEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, enabled]);

  function connectAndListen() {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    socket.onAny(onEvent);
    return socket;
  }

  function onEvent(event: string, ...args: unknown[]) {
    const payload = args[0] as Record<string, unknown> | undefined;
    switch (event) {
      case "message":
      case "message:new":
        handleNewMessage(payload as unknown as Message);
        break;
      case "message:updated":
        upsertMessage(payload as unknown as Message);
        break;
      case "message:deleted": {
        const { messageId, channelId } = payload as { messageId: string; channelId: string };
        queryClient.setQueryData<InfiniteData<MessagesPage>>(
          ["messages", channelId],
          (data) =>
            data && {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                messages: p.messages.map((m) =>
                  m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), content: "[deleted]" } : m,
                ),
              })),
            },
        );
        break;
      }
      case "reaction:update": {
        const evt = payload as {
          channelId: string;
          messageId: string;
          emoji: string;
          userId: string;
          action: "added" | "removed";
        };
        patchMessage(evt.channelId, evt.messageId, (m) => {
          const others = m.reactions.filter(
            (r) => !(r.userId === evt.userId && r.emoji === evt.emoji),
          );
          const reaction =
            evt.action === "added"
              ? [{ id: `${evt.messageId}:${evt.userId}:${evt.emoji}`, messageId: evt.messageId, userId: evt.userId, emoji: evt.emoji }]
              : [];
          return { ...m, reactions: [...others, ...reaction] };
        });
        break;
      }
      case "typing:update": {
        const evt = payload as { channelId: string; userId: string; isTyping: boolean };
        const current = useChatStore.getState().typingUsers[evt.channelId] ?? [];
        const next = evt.isTyping
          ? current.includes(evt.userId)
            ? current
            : [...current, evt.userId]
          : current.filter((id) => id !== evt.userId);
        setTyping(evt.channelId, next);
        break;
      }
      case "presence:update": {
        const evt = payload as { userId: string; status: string };
        setPresence(evt.userId, evt.status);
        break;
      }
      case "notification:new":
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        break;
      case "llm:typing": {
        const evt = payload as { channelId: string; connectionId: string; isTyping: boolean };
        if (evt.isTyping) setLlmStream(evt.channelId, { connectionId: evt.connectionId, text: "" });
        else clearLlmStream(evt.channelId, evt.connectionId);
        break;
      }
      case "llm:delta": {
        const evt = payload as { channelId: string; connectionId: string; delta: string };
        const cur = useChatStore.getState().llmStreams[evt.channelId];
        if (cur?.connectionId === evt.connectionId) {
          setLlmStream(evt.channelId, { connectionId: evt.connectionId, text: cur.text + evt.delta });
        }
        break;
      }
      case "llm:error": {
        const evt = payload as { channelId: string; connectionId: string };
        clearLlmStream(evt.channelId, evt.connectionId);
        break;
      }
      default:
        break;
    }
  }

  function clearLlmStream(channelId: string, connectionId?: string) {
    const cur = useChatStore.getState().llmStreams[channelId];
    if (!cur || (connectionId && cur.connectionId !== connectionId)) return;
    setLlmStream(channelId, null);
  }

  /** Insert incoming message into its channel cache in ULID order, deduping by id/nonce. */
  function handleNewMessage(msg: Message) {
    if (!msg?.channelId) return;
    // final LLM reply landed — drop the streaming indicator
    if (msg.llmConnectionId) clearLlmStream(msg.channelId, msg.llmConnectionId);
    // live-refresh open threads when a reply lands
    if (msg.parentId) queryClient.invalidateQueries({ queryKey: ["replies", msg.parentId] });
    queryClient.setQueryData<InfiniteData<MessagesPage>>(["messages", msg.channelId], (data) => {
      if (!data) return data; // channel not loaded — will be fetched on open
      const pages = data.pages.map((p, i) =>
        i === 0 ? { ...p, messages: [...p.messages] } : p,
      );
      // newest page is pages[0] (DESC order from API)
      const first = pages[0];
      const exists = data.pages.some((p) =>
        p.messages.some((m) => m.id === msg.id || (!!msg.nonce && m.nonce === msg.nonce)),
      );
      if (!exists) first.messages.unshift(msg);
      return { ...data, pages };
    });
  }

  function upsertMessage(msg: Message) {
    if (!msg?.channelId) return;
    patchMessage(msg.channelId, msg.id, () => msg);
  }

  function patchMessage(channelId: string, messageId: string, fn: (m: Message) => Message) {
    queryClient.setQueryData<InfiniteData<MessagesPage>>(["messages", channelId], (data) =>
      data && {
        ...data,
        pages: data.pages.map((p) => ({
          ...p,
          messages: p.messages.map((m) => (m.id === messageId ? fn(m) : m)),
        })),
      },
    );
  }
}

export function joinChannelRoom(channelId: string) {
  const socket = getSocket();
  if (!socket.connected) socket.connect();
  socket.emit("join:channel", channelId);
}

export function leaveChannelRoom(channelId: string) {
  getSocket().emit("leave:channel", channelId);
}

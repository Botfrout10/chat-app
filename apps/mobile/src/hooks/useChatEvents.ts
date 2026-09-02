import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useEffect } from "react";

import { getSocket } from "@/lib/socket";
import { useChatStore } from "@/stores/chat";
import type { MessagesPage, Message, Member } from "@/types";

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
  const setAgentStream = useChatStore((s) => s.setAgentStream);
  const appendAgentText = useChatStore((s) => s.appendAgentText);
  const appendAgentThinking = useChatStore((s) => s.appendAgentThinking);
  const appendAgentTool = useChatStore((s) => s.appendAgentTool);
  const setAgentPermission = useChatStore((s) => s.setAgentPermission);
  const setAgentQuestion = useChatStore((s) => s.setAgentQuestion);
  const clearAgentStream = useChatStore((s) => s.clearAgentStream);
  const setAgentTyping = useChatStore((s) => s.setAgentTyping);

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
      case "notification:new": {
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        // a workspace invite/add also arrives as a notification — refresh workspace/channel lists
        queryClient.invalidateQueries({ queryKey: ["workspaces"] });
        queryClient.invalidateQueries({ queryKey: ["channels"] });
        const n = payload as { workspaceId?: string } | null;
        if (n?.workspaceId) queryClient.invalidateQueries({ queryKey: ["channels", n.workspaceId] });
        break;
      }
      case "read:receipt": {
        const evt = payload as { channelId: string; userId: string; lastReadMessageId: string };
        queryClient.setQueryData<Member[]>(["channelMembers", evt.channelId], (prev) =>
          prev?.map((m) => (m.id === evt.userId ? { ...m, lastReadMessageId: evt.lastReadMessageId } : m)),
        );
        break;
      }
      case "llm:typing": {
        const evt = payload as { channelId: string; connectionId: string; isTyping: boolean };
        if (evt.isTyping) setLlmStream(evt.channelId, { connectionId: evt.connectionId, text: "", thinking: "" });
        else clearLlmStream(evt.channelId);
        break;
      }
      case "llm:thinking": {
        const evt = payload as { channelId: string; connectionId: string; delta: string };
        const cur = useChatStore.getState().llmStreams[evt.channelId];
        if (cur) {
          if (cur.connectionId === evt.connectionId) {
            setLlmStream(evt.channelId, {
              connectionId: evt.connectionId,
              text: cur.text,
              thinking: cur.thinking + evt.delta,
            });
          }
        } else {
          // typing event missed/race — create stream with thinking
          setLlmStream(evt.channelId, { connectionId: evt.connectionId, text: "", thinking: evt.delta });
        }
        break;
      }
      case "llm:delta": {
        const evt = payload as { channelId: string; connectionId: string; delta: string };
        const cur = useChatStore.getState().llmStreams[evt.channelId];
        if (cur) {
          if (cur.connectionId === evt.connectionId) {
            setLlmStream(evt.channelId, { connectionId: evt.connectionId, text: cur.text + evt.delta, thinking: cur.thinking });
          } else {
            // different connection — replace with new text
            setLlmStream(evt.channelId, { connectionId: evt.connectionId, text: evt.delta, thinking: cur.thinking });
          }
        } else {
          setLlmStream(evt.channelId, { connectionId: evt.connectionId, text: evt.delta, thinking: "" });
        }
        break;
      }
      case "llm:error": {
        const evt = payload as { channelId: string; connectionId: string };
        clearLlmStream(evt.channelId);
        break;
      }
      case "agent:typing": {
        const evt = payload as { channelId: string; agentId: string; sessionId?: string | null; isTyping: boolean };
        if (evt.isTyping) {
          const cur = useChatStore.getState().agentStreams[evt.channelId];
          if (!cur || cur.agentId !== evt.agentId) setAgentStream(evt.channelId, { agentId: evt.agentId, sessionId: evt.sessionId ?? null, text: "", thinking: "", toolCalls: [], permission: null, question: null });
          setAgentTyping(evt.channelId, evt.agentId);
        } else {
          setAgentTyping(evt.channelId, null);
        }
        break;
      }
      case "agent:thinking": {
        const evt = payload as { channelId: string; agentId: string; delta: string };
        appendAgentThinking(evt.channelId, evt.agentId, evt.delta);
        break;
      }
      case "agent:delta": {
        const evt = payload as { channelId: string; agentId: string; delta: string };
        appendAgentText(evt.channelId, evt.agentId, evt.delta);
        break;
      }
      case "agent:tool": {
        const evt = payload as { channelId: string; agentId: string; tool: string; args?: unknown; id?: string };
        appendAgentTool(evt.channelId, evt.agentId, evt.tool ?? "tool", evt.args);
        break;
      }
      case "agent:tool_result": {
        // tool result shown inline — for mobile just append to thinking
        const evt = payload as { channelId: string; agentId: string; tool: string; result: string };
        appendAgentThinking(evt.channelId, evt.agentId, `\n[tool ${evt.tool} result: ${String(evt.result).slice(0, 200)}]\n`);
        break;
      }
      case "agent:plan": {
        const evt = payload as { channelId: string; agentId: string; text: string };
        const cur = useChatStore.getState().agentStreams[evt.channelId];
        if (cur) setAgentStream(evt.channelId, { ...cur, text: cur.text + `\n[plan: ${evt.text}]\n` } as any);
        break;
      }
      case "agent:permission": {
        const evt = payload as { channelId: string; agentId: string; text: string; id?: string };
        setAgentPermission(evt.channelId, evt.agentId, evt.text, evt.id);
        break;
      }
      case "agent:question": {
        const evt = payload as { channelId: string; agentId: string; text: string; id?: string };
        setAgentQuestion(evt.channelId, evt.agentId, evt.text, evt.id);
        break;
      }
      case "agent:ack":
      case "agent:queue":
        break;
      case "agent:error": {
        const evt = payload as { channelId: string };
        clearAgentStream(evt.channelId);
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
    if ((msg as any).agentId) clearAgentStream((msg as any).channelId ?? msg.channelId);
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

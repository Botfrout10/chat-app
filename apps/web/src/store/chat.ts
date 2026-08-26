"use client";
import { create } from "zustand";

type Workspace = { id: string; name: string; slug: string };
type Channel = { id: string; name: string; type: string; workspaceId: string; dmPeer?: { id: string; name: string } | null; llmConnectionId?: string | null; lastReadMessageId?: string | null };

type LlmStream = { connectionId: string; text: string; thinking: string };

type State = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  channels: Channel[];
  activeChannelId: string | null;
  typingUsers: Record<string, string[]>; // channelId -> userIds
  presence: Record<string, string>; // userId -> status
  /** live LLM streams keyed by channel — survives switching channels mid-generation */
  llmStreams: Record<string, LlmStream | null>;
  /** channelId -> connectionId currently typing */
  llmTyping: Record<string, string | null>;
  setWorkspaces: (w: Workspace[]) => void;
  setActiveWorkspace: (id: string | null) => void;
  setChannels: (c: Channel[]) => void;
  setActiveChannel: (id: string | null) => void;
  setTyping: (channelId: string, userIds: string[]) => void;
  setPresence: (userId: string, status: string) => void;
  setPresenceBulk: (map: Record<string, string>) => void;
  startLlmStream: (channelId: string, connectionId: string) => void;
  appendLlmThinking: (channelId: string, connectionId: string, delta: string) => void;
  appendLlmText: (channelId: string, connectionId: string, delta: string) => void;
  clearLlmStream: (channelId: string) => void;
  clearLlmStreamByConnection: (connectionId: string) => void;
  setLlmTyping: (channelId: string, connectionId: string | null) => void;
};

export const useChatStore = create<State>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  channels: [],
  activeChannelId: null,
  typingUsers: {},
  presence: {},
  llmStreams: {},
  llmTyping: {},
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setChannels: (channels) => set({ channels }),
  setActiveChannel: (activeChannelId) => set({ activeChannelId }),
  setTyping: (channelId, userIds) =>
    set((s) => ({ typingUsers: { ...s.typingUsers, [channelId]: userIds } })),
  setPresence: (userId, status) => set((s) => ({ presence: { ...s.presence, [userId]: status } })),
  setPresenceBulk: (map) => set((s) => ({ presence: { ...s.presence, ...map } })),
  startLlmStream: (channelId, connectionId) =>
    set((s) => ({ llmStreams: { ...s.llmStreams, [channelId]: { connectionId, text: "", thinking: "" } } })),
  appendLlmThinking: (channelId, connectionId, delta) =>
    set((s) => {
      const cur = s.llmStreams[channelId];
      if (!cur || cur.connectionId !== connectionId) return s;
      return { llmStreams: { ...s.llmStreams, [channelId]: { ...cur, thinking: cur.thinking + delta } } };
    }),
  appendLlmText: (channelId, connectionId, delta) =>
    set((s) => {
      const cur = s.llmStreams[channelId];
      if (!cur || cur.connectionId !== connectionId) return s;
      return { llmStreams: { ...s.llmStreams, [channelId]: { ...cur, text: cur.text + delta } } };
    }),
  clearLlmStream: (channelId) =>
    set((s) => ({ llmStreams: { ...s.llmStreams, [channelId]: null }, llmTyping: { ...s.llmTyping, [channelId]: null } })),
  clearLlmStreamByConnection: (connectionId) =>
    set((s) => {
      const streams = { ...s.llmStreams };
      const typing = { ...s.llmTyping };
      for (const ch of s.channels) {
        if (ch.llmConnectionId === connectionId) {
          streams[ch.id] = null;
          typing[ch.id] = null;
        }
      }
      return { llmStreams: streams, llmTyping: typing };
    }),
  setLlmTyping: (channelId, connectionId) =>
    set((s) => ({ llmTyping: { ...s.llmTyping, [channelId]: connectionId } })),
}));

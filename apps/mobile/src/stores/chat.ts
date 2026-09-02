import { create } from "zustand";

import type { Channel, Workspace } from "@/types";

type State = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  channels: Channel[];
  activeChannelId: string | null;
  /** channelId -> userIds currently typing */
  typingUsers: Record<string, string[]>;
  /** userId -> status ("online" | "offline" | "away") */
  presence: Record<string, string>;
  /** channelId -> in-flight LLM generation (typing indicator + accumulated deltas) */
  llmStreams: Record<string, { connectionId: string; text: string; thinking: string }>;
  agentStreams: Record<string, { agentId: string; sessionId?: string | null; text: string; thinking: string; toolCalls: Array<{ tool: string; args?: unknown }>; permission?: { text: string; id?: string } | null; question?: { text: string; id?: string } | null }>;
  agentTyping: Record<string, string | null>;
  setWorkspaces: (w: Workspace[]) => void;
  setActiveWorkspace: (id: string | null) => void;
  setChannels: (c: Channel[]) => void;
  setActiveChannel: (id: string | null) => void;
  setTyping: (channelId: string, userIds: string[]) => void;
  setPresence: (userId: string, status: string) => void;
  setLlmStream: (channelId: string, stream: { connectionId: string; text: string; thinking: string } | null) => void;
  setAgentStream: (channelId: string, stream: { agentId: string; sessionId?: string | null; text: string; thinking: string; toolCalls: Array<{ tool: string; args?: unknown }>; permission?: { text: string; id?: string } | null; question?: { text: string; id?: string } | null } | null) => void;
  appendAgentText: (channelId: string, agentId: string, delta: string) => void;
  appendAgentThinking: (channelId: string, agentId: string, delta: string) => void;
  appendAgentTool: (channelId: string, agentId: string, tool: string, args?: unknown) => void;
  setAgentPermission: (channelId: string, agentId: string, text: string, id?: string) => void;
  setAgentQuestion: (channelId: string, agentId: string, text: string, id?: string) => void;
  clearAgentStream: (channelId: string) => void;
  setAgentTyping: (channelId: string, agentId: string | null) => void;
  reset: () => void;
};

export const useChatStore = create<State>((set) => ({
  workspaces: [],
  activeWorkspaceId: null,
  channels: [],
  activeChannelId: null,
  typingUsers: {},
  presence: {},
  llmStreams: {},
  agentStreams: {},
  agentTyping: {},
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setChannels: (channels) => set({ channels }),
  setActiveChannel: (activeChannelId) => set({ activeChannelId }),
  setTyping: (channelId, userIds) =>
    set((s) => ({ typingUsers: { ...s.typingUsers, [channelId]: userIds } })),
  setPresence: (userId, status) =>
    set((s) => ({ presence: { ...s.presence, [userId]: status } })),
  setLlmStream: (channelId, stream) =>
    set((s) => {
      const llmStreams = { ...s.llmStreams };
      if (stream) llmStreams[channelId] = stream;
      else delete llmStreams[channelId];
      return { llmStreams };
    }),
  setAgentStream: (channelId, stream) =>
    set((s) => {
      const agentStreams = { ...s.agentStreams };
      if (stream) agentStreams[channelId] = stream;
      else delete agentStreams[channelId];
      return { agentStreams };
    }),
  appendAgentText: (channelId, agentId, delta) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, text: cur.text + delta } } };
    }),
  appendAgentThinking: (channelId, agentId, delta) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, thinking: cur.thinking + delta } } };
    }),
  appendAgentTool: (channelId, agentId, tool, args) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, toolCalls: [...cur.toolCalls, { tool, args }] } } };
    }),
  setAgentPermission: (channelId, agentId, text, id) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, permission: { text, id } } } };
    }),
  setAgentQuestion: (channelId, agentId, text, id) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, question: { text, id } } } };
    }),
  clearAgentStream: (channelId) =>
    set((s) => {
      const agentStreams = { ...s.agentStreams };
      delete agentStreams[channelId];
      const agentTyping = { ...s.agentTyping };
      delete agentTyping[channelId];
      return { agentStreams, agentTyping };
    }),
  setAgentTyping: (channelId, agentId) =>
    set((s) => ({ agentTyping: { ...s.agentTyping, [channelId]: agentId } })),
  reset: () =>
    set({
      workspaces: [],
      activeWorkspaceId: null,
      channels: [],
      activeChannelId: null,
      typingUsers: {},
      presence: {},
      llmStreams: {},
      agentStreams: {},
      agentTyping: {},
    }),
}));

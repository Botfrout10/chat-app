"use client";
import { create } from "zustand";

type Workspace = { id: string; name: string; slug: string };
type Channel = { id: string; name: string; type: string; workspaceId: string; dmPeer?: { id: string; name: string } | null; llmConnectionId?: string | null; lastReadMessageId?: string | null };

type LlmStream = { connectionId: string; text: string; thinking: string };

type AgentStream = { agentId: string; sessionId?: string | null; text: string; thinking: string; toolCalls: Array<{ tool: string; args?: unknown; result?: string; id?: string }>; plan?: string; permission?: { text: string; id?: string } | null; question?: { text: string; id?: string } | null; subagents?: Array<{ text: string; id?: string }>; queueDepth?: number };

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
  agentStreams: Record<string, AgentStream | null>;
  agentTyping: Record<string, string | null>;
  highlightedMessageId: string | null;
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
  startAgentStream: (channelId: string, agentId: string, sessionId?: string | null) => void;
  appendAgentThinking: (channelId: string, agentId: string, delta: string) => void;
  appendAgentText: (channelId: string, agentId: string, delta: string) => void;
  appendAgentTool: (channelId: string, agentId: string, tool: string, args?: unknown, id?: string) => void;
  appendAgentToolResult: (channelId: string, agentId: string, tool: string, result: string) => void;
  setAgentPlan: (channelId: string, agentId: string, text: string) => void;
  setAgentPermission: (channelId: string, agentId: string, text: string, id?: string) => void;
  clearAgentPermission: (channelId: string) => void;
  setAgentQuestion: (channelId: string, agentId: string, text: string, id?: string) => void;
  clearAgentQuestion: (channelId: string) => void;
  appendAgentSubagent: (channelId: string, agentId: string, text: string, id?: string) => void;
  setAgentQueueDepth: (channelId: string, depth: number) => void;
  clearAgentStream: (channelId: string) => void;
  setAgentTyping: (channelId: string, agentId: string | null) => void;
  setHighlightedMessage: (id: string | null) => void;
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
  agentStreams: {},
  agentTyping: {},
  highlightedMessageId: null,
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
  startAgentStream: (channelId, agentId, sessionId) =>
    set((s) => ({ agentStreams: { ...s.agentStreams, [channelId]: { agentId, sessionId: sessionId ?? null, text: "", thinking: "", toolCalls: [], plan: undefined, permission: null, question: null, subagents: [], queueDepth: 0 } } })),
  appendAgentThinking: (channelId, agentId, delta) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, thinking: cur.thinking + delta } } };
    }),
  appendAgentText: (channelId, agentId, delta) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, text: cur.text + delta } } };
    }),
  appendAgentTool: (channelId, agentId, tool, args, id) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, toolCalls: [...cur.toolCalls, { tool, args, id }] } } };
    }),
  appendAgentToolResult: (channelId, agentId, tool, result) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      // attach result to last matching tool without result
      const tcs = cur.toolCalls.map((t) => t.tool === tool && !t.result ? { ...t, result } : t);
      // if not found, push as standalone
      if (!tcs.some((t) => t.tool === tool && t.result === result)) {
        // fallback: update last tool
        const lastIdx = [...tcs].reverse().findIndex((t) => t.tool === tool);
        if (lastIdx === -1) tcs.push({ tool, result } as any);
      }
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, toolCalls: tcs } } };
    }),
  setAgentPlan: (channelId, agentId, text) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, plan: text } } };
    }),
  setAgentPermission: (channelId, agentId, text, id) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, permission: { text, id } } } };
    }),
  clearAgentPermission: (channelId) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, permission: null } } };
    }),
  setAgentQuestion: (channelId, agentId, text, id) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, question: { text, id } } } };
    }),
  clearAgentQuestion: (channelId) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, question: null } } };
    }),
  appendAgentSubagent: (channelId, agentId, text, id) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur || cur.agentId !== agentId) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, subagents: [...(cur.subagents ?? []), { text, id }] } } };
    }),
  setAgentQueueDepth: (channelId, depth) =>
    set((s) => {
      const cur = s.agentStreams[channelId];
      if (!cur) return s;
      return { agentStreams: { ...s.agentStreams, [channelId]: { ...cur, queueDepth: depth } } };
    }),
  clearAgentStream: (channelId) =>
    set((s) => ({ agentStreams: { ...s.agentStreams, [channelId]: null }, agentTyping: { ...s.agentTyping, [channelId]: null } })),
  setAgentTyping: (channelId, agentId) =>
    set((s) => ({ agentTyping: { ...s.agentTyping, [channelId]: agentId } })),
  setHighlightedMessage: (id) => set({ highlightedMessageId: id }),
}));

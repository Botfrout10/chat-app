"use client";
import { create } from "zustand";

type Workspace = { id: string; name: string; slug: string };
type Channel = { id: string; name: string; type: string; workspaceId: string; dmPeer?: { id: string; name: string } | null };

type State = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  channels: Channel[];
  activeChannelId: string | null;
  typingUsers: Record<string, string[]>; // channelId -> userIds
  presence: Record<string, string>; // userId -> status
  setWorkspaces: (w: Workspace[]) => void;
  setActiveWorkspace: (id: string | null) => void;
  setChannels: (c: Channel[]) => void;
  setActiveChannel: (id: string | null) => void;
  setTyping: (channelId: string, userIds: string[]) => void;
  setPresence: (userId: string, status: string) => void;
};

export const useChatStore = create<State>((set) => ({
  workspaces: [],
  activeWorkspaceId: null,
  channels: [],
  activeChannelId: null,
  typingUsers: {},
  presence: {},
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setChannels: (channels) => set({ channels }),
  setActiveChannel: (activeChannelId) => set({ activeChannelId }),
  setTyping: (channelId, userIds) =>
    set((s) => ({ typingUsers: { ...s.typingUsers, [channelId]: userIds } })),
  setPresence: (userId, status) => set((s) => ({ presence: { ...s.presence, [userId]: status } })),
}));

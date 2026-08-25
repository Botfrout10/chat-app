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
  setWorkspaces: (w: Workspace[]) => void;
  setActiveWorkspace: (id: string | null) => void;
  setChannels: (c: Channel[]) => void;
  setActiveChannel: (id: string | null) => void;
  setTyping: (channelId: string, userIds: string[]) => void;
  setPresence: (userId: string, status: string) => void;
  reset: () => void;
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
  setPresence: (userId, status) =>
    set((s) => ({ presence: { ...s.presence, [userId]: status } })),
  reset: () =>
    set({
      workspaces: [],
      activeWorkspaceId: null,
      channels: [],
      activeChannelId: null,
      typingUsers: {},
      presence: {},
    }),
}));

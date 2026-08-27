"use client";
import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useChatStore } from "@/store/chat";

/** Re-fetch channels of the active workspace into the store. */
export function useRefreshChannels() {
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const setChannels = useChatStore((s) => s.setChannels);
  return useCallback(async () => {
    if (!activeWorkspaceId) return [];
    const chs: any[] = await api.channels(activeWorkspaceId);
    setChannels(chs);
    return chs;
  }, [activeWorkspaceId, setChannels]);
}

/** Open (or create) a 1:1 DM with a user and select it. */
export function useOpenDm() {
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const refresh = useRefreshChannels();
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  return useCallback(
    async (userId: string) => {
      if (!activeWorkspaceId) return;
      try {
        const ch: any = await api.createDm(activeWorkspaceId, userId);
        await refresh();
        setActiveChannel(ch.id);
      } catch (e: any) {
        toast.error((e.message ?? "Failed to open DM").slice(0, 160));
      }
    },
    [activeWorkspaceId, refresh, setActiveChannel],
  );
}

/** Open (or create) the DM channel for an AI model connection and select it. */
export function useOpenLlmDm() {
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const refresh = useRefreshChannels();
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  return useCallback(
    async (connectionId: string) => {
      if (!activeWorkspaceId) return;
      try {
        const ch: any = await api.createLlmDm(connectionId, activeWorkspaceId);
        const chs: any[] = await refresh();
        // defensive patch: backend now enriches llmConnectionId, but if refresh
        // raced or missed it, patch the entry so the context indicator appears
        // without requiring a second fetch
        if (ch?.llmConnectionId) {
          const patched = chs.map((c: any) =>
            c.id === ch.id ? { ...c, llmConnectionId: c.llmConnectionId ?? ch.llmConnectionId, modelLabel: c.modelLabel ?? ch.modelLabel } : c
          );
          const found = patched.find((c: any) => c.id === ch.id);
          if (found && !chs.find((c: any) => c.id === ch.id)?.llmConnectionId) {
            useChatStore.getState().setChannels(patched);
          }
        }
        setActiveChannel(ch.id);
      } catch (e: any) {
        toast.error((e.message ?? "Failed to open model chat").slice(0, 160));
      }
    },
    [activeWorkspaceId, refresh, setActiveChannel],
  );
}

/**
 * Keep workspace-wide presence in the Zustand store.
 * Mount once in AppShell — replaces per-component local presence maps.
 */
export function usePresenceSync(enabled: boolean) {
  const setPresence = useChatStore((s) => s.setPresence);
  const setPresenceBulk = useChatStore((s) => s.setPresenceBulk);
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    const onUpdate = (p: { userId: string; status: string }) => setPresence(p.userId, p.status);
    s.on("presence:update", onUpdate);
    s.emit("presence:list");
    s.on("presence:list", (list: { userId: string; status: string }[]) => {
      const map: Record<string, string> = {};
      for (const p of list) map[p.userId] = p.status;
      setPresenceBulk(map);
    });
    return () => {
      s.off("presence:update", onUpdate);
    };
  }, [enabled, setPresence, setPresenceBulk]);
}

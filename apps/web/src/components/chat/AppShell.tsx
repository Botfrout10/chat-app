"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "@/store/ui";
import { PanelLeftOpen, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { useChatStore } from "@/store/chat";
import { usePresenceSync } from "@/hooks/useChatActions";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "./AppSidebar";
import { ChannelView } from "./ChannelView";
import { CommandPalette } from "./CommandPalette";
import { ThreadPanel } from "./ThreadPanel";
import { DialogHost } from "@/components/dialogs/DialogHost";

export function AppShell() {
  // selector subscriptions — avoids re-rendering the whole shell on every
  // llm:delta token (each set() creates a new state object)
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const channels = useChatStore((s) => s.channels);
  const sidebarHidden = useUiStore((s) => s.sidebarHidden);
  const showSidebar = useUiStore((s) => s.showSidebar);

  // Ctrl/Cmd+B toggles the sidebar — lives here so it works even when the
  // sidebar is hidden and <AppSidebar /> isn't mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        useUiStore.getState().toggleSidebar();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null) });
  const meId = (me as any)?.id as string | undefined;

  // load workspaces
  useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const data = await api.workspaces().catch(() => []);
      useChatStore.getState().setWorkspaces(data as any);
      if (!activeWorkspaceId && (data as any)?.[0]) useChatStore.getState().setActiveWorkspace((data as any)[0].id);
      return data;
    },
  });

  // load channels when workspace changes — also merge global DMs (friends) so they appear regardless of workspace
  useEffect(() => {
    if (!activeWorkspaceId) return;
    Promise.all([api.channels(activeWorkspaceId).catch(() => []), (api as any).dms().catch(() => [])]).then(([chs, dms]: any) => {
      const merged: any[] = [...(chs as any[])];
      const existingIds = new Set(merged.map((c: any) => c.id));
      for (const d of (dms as any[])) {
        if (!existingIds.has(d.id)) merged.push(d);
      }
      useChatStore.getState().setChannels(merged as any);
      if (!useChatStore.getState().activeChannelId && (merged as any)?.[0]) useChatStore.getState().setActiveChannel((merged as any)[0].id);
    }).catch(() => useChatStore.getState().setChannels([]));
  }, [activeWorkspaceId]);

  // keep global DMs fresh even when workspace doesn't change (friends are global)
  useEffect(() => {
    if (!meId) return;
    const refreshGlobal = () => {
      (api as any)
        .dms()
        .then((dms: any) => {
          const current = useChatStore.getState().channels;
          const ids = new Set(current.map((c: any) => c.id));
          const toAdd = (dms as any[]).filter((d: any) => !ids.has(d.id));
          if (toAdd.length) useChatStore.getState().setChannels([...current, ...toAdd] as any);
        })
        .catch(() => {});
    };
    refreshGlobal();
    const id = setInterval(refreshGlobal, 30_000);
    return () => clearInterval(id);
  }, [meId]);

  // realtime + presence (single source of truth: the Zustand store)
  useEffect(() => { if (meId) connectSocket(); }, [meId]);
  usePresenceSync(!!meId);

  // global LLM stream listeners — keyed by channel in the store so a stream
  // keeps accumulating even while the user is looking at another channel
  useEffect(() => {
    const s = connectSocket();
    const st = () => useChatStore.getState();
    const onTyping = (p: any) => {
      if (!p.channelId) return;
      st().setLlmTyping(p.channelId, p.isTyping ? p.connectionId : null);
      if (p.isTyping) st().startLlmStream(p.channelId, p.connectionId);
    };
    const onThinking = (p: any) => {
      if (p.channelId && p.delta) st().appendLlmThinking(p.channelId, p.connectionId, p.delta);
    };
    const onDelta = (p: any) => {
      if (p.channelId && p.delta) st().appendLlmText(p.channelId, p.connectionId, p.delta);
    };
    const onError = (p: any) => {
      if (p.channelId) st().clearLlmStream(p.channelId);
    };
    const onNew = (msg: any) => {
      // final LLM reply arrived — drop that channel's live stream placeholder.
      // key off msg.channelId: the channels-list API doesn't return
      // llmConnectionId, so matching by connection would never hit.
      if (msg?.llmConnectionId && msg?.channelId) st().clearLlmStream(msg.channelId);
    };
    s.on("llm:typing", onTyping);
    s.on("llm:thinking", onThinking);
    s.on("llm:delta", onDelta);
    s.on("llm:error", onError);
    s.on("message:new", onNew);
    s.on("message", onNew);
    return () => {
      s.off("llm:typing", onTyping);
      s.off("llm:thinking", onThinking);
      s.off("llm:delta", onDelta);
      s.off("llm:error", onError);
      s.off("message:new", onNew);
      s.off("message", onNew);
    };
  }, []);

  if (!meId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--muted)] p-4">
        <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-soft)] text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="mt-3 text-lg font-semibold text-[var(--foreground)]">Sign in to continue</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">Create a workspace, invite your team, start talking.</p>
          <div className="mt-4 flex gap-2 justify-center">
            <Button asChild><a href="/login">Sign in</a></Button>
            <Button variant="outline" asChild><a href="/login?mode=signup">Create account</a></Button>
          </div>
          <div className="mt-4 text-xs text-[var(--muted-foreground)]">Tip: `docker compose up -d` → Postgres, Redis, MinIO ready.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--background)] relative">
      {!sidebarHidden && <AppSidebar />}
      {sidebarHidden && (
        <button
          onClick={showSidebar}
          title="Show sidebar (Ctrl+B)"
          className="absolute top-3 left-3 z-30 h-8 w-8 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-soft)] flex items-center justify-center text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      {/* main */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--background)]">
        {(() => {
          const activeChannel = channels.find((c) => c.id === activeChannelId);
          if (activeChannelId && activeChannel) {
            return (
              <ChannelView
                key={activeChannelId}
                channelId={activeChannelId}
                workspaceId={(activeChannel as any)?.workspaceId ?? activeWorkspaceId ?? undefined}
                channel={activeChannel}
              />
            );
          }
          if (activeChannelId && !activeChannel) {
            // global DM not yet in store — still render with just id
            return <ChannelView key={activeChannelId} channelId={activeChannelId} workspaceId={activeWorkspaceId ?? undefined} channel={undefined} />;
          }
          return (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
              Select a channel on the left — or press <kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-xs">Ctrl</kbd>+
              <kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-xs">P</kbd> to search.
            </div>
          );
        })()}
      </div>

      <DialogHost />
      <CommandPalette />
      <ThreadPanel />
    </div>
  );
}

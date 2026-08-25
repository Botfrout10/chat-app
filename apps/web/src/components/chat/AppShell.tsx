"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { useChatStore } from "@/store/chat";
import { usePresenceSync } from "@/hooks/useChatActions";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "./AppSidebar";
import { ChannelView } from "./ChannelView";
import { CommandPalette } from "./CommandPalette";
import { DialogHost } from "@/components/dialogs/DialogHost";

export function AppShell() {
  const { activeWorkspaceId, activeChannelId, channels, setWorkspaces, setActiveWorkspace, setChannels } = useChatStore();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null) });
  const meId = (me as any)?.id as string | undefined;

  // load workspaces
  useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const data = await api.workspaces().catch(() => []);
      setWorkspaces(data as any);
      if (!activeWorkspaceId && (data as any)?.[0]) setActiveWorkspace((data as any)[0].id);
      return data;
    },
  });

  // load channels when workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) return;
    api.channels(activeWorkspaceId).then((chs: any) => {
      setChannels(chs as any);
      if (!activeChannelId && (chs as any)?.[0]) useChatStore.getState().setActiveChannel((chs as any)[0].id);
    }).catch(() => setChannels([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // realtime + presence (single source of truth: the Zustand store)
  useEffect(() => { if (meId) connectSocket(); }, [meId]);
  usePresenceSync(!!meId);

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
    <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--background)]">
      <AppSidebar />

      {/* main */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--background)]">
        {activeChannelId ? (
          <ChannelView
            key={activeChannelId}
            channelId={activeChannelId}
            workspaceId={activeWorkspaceId ?? undefined}
            channel={channels.find((c) => c.id === activeChannelId)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
            Select a channel on the left — or press <kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-xs">Ctrl</kbd>+<kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-xs">P</kbd> to search.
          </div>
        )}
      </div>

      <DialogHost />
      <CommandPalette />
    </div>
  );
}

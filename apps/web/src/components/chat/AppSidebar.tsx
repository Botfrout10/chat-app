"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Bell,
  BrainCircuit,
  ChevronDown,
  Hash,
  Lock,
  LogOut,
  ArrowLeftRight,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";
import { useOpenDm, useOpenLlmDm } from "@/hooks/useChatActions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Kbd } from "@/components/ui/kbd";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

function SectionHeader({ label, onAdd, addTitle }: { label: string; onAdd?: () => void; addTitle?: string }) {
  return (
    <div className="flex items-center justify-between px-3 pt-4 pb-1">
      <span className="text-[11px] font-semibold tracking-widest text-white/40">{label}</span>
      {onAdd && (
        <button
          onClick={onAdd}
          title={addTitle}
          className="h-5 w-5 rounded-md bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function SidebarButton({
  active,
  onClick,
  children,
  unread,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  unread?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-full text-left mx-2 px-2 py-1.5 rounded-[var(--radius-md)] text-sm flex items-center gap-2 ${
        active
          ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-soft)]"
          : "text-white/60 hover:bg-white/5 hover:text-white"
      }`}
    >
      {children}
      {unread && !active && <span className="ml-auto h-2 w-2 rounded-full bg-[var(--accent)] shrink-0" title="Unread" />}
    </button>
  );
}

export function AppSidebar() {
  const qc = useQueryClient();
  const { workspaces, activeWorkspaceId, channels, activeChannelId, setActiveChannel, presence } = useChatStore();
  const openDialog = useUiStore((s) => s.openDialog);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null) });

  // members for DM list
  const { data: wsMembers } = useQuery({
    queryKey: ["members", activeWorkspaceId],
    queryFn: () => api.members(activeWorkspaceId!).catch(() => []),
    enabled: !!activeWorkspaceId,
  });
  const dmCandidates = ((wsMembers as any[]) ?? []).filter((m) => m.id !== (me as any)?.id);

  // AI model connections
  const { data: llmConnections } = useQuery({
    queryKey: ["llm-connections"],
    queryFn: () => api.llmConnections().catch(() => []),
  });

  const openDm = useOpenDm();
  const openLlmDm = useOpenLlmDm();

  // notifications
  const [notifsOpen, setNotifsOpen] = useState(false);
  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications().catch(() => ({ items: [], unread: 0 })),
    refetchInterval: 20000,
    enabled: !!(me as any)?.id,
  });
  useEffect(() => {
    if (!(me as any)?.id) return;
    const s = getSocket();
    const h = () => qc.invalidateQueries({ queryKey: ["notifications"] });
    s.on("notification:new", h);
    return () => { s.off("notification:new", h); };
  }, [me, qc]);

  // sidebar lists only channels — DMs and model chats live in their own sections
  const channelList = channels.filter((c) => c.type === "public" || c.type === "private");

  return (
    <aside className="w-[260px] shrink-0 bg-[var(--sidebar-muted)] text-[var(--sidebar-foreground)] hidden md:flex flex-col border-r border-[var(--sidebar-border)]">
      {/* header: workspace switcher + actions */}
      <div className="h-14 px-3 flex items-center gap-1 border-b border-[var(--sidebar-border)]">
        <WorkspaceSwitcher />
        <Popover open={notifsOpen} onOpenChange={setNotifsOpen}>
          <PopoverTrigger asChild>
            <button
              className="relative h-7 w-7 shrink-0 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 flex items-center justify-center"
              title="Notifications"
            >
              <Bell className="h-3.5 w-3.5" />
              {(notifData?.unread ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-[10px] font-bold flex items-center justify-center">
                  {notifData!.unread > 9 ? "9+" : notifData!.unread}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-80 p-0">
            <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--border)]">
              <span className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)]">NOTIFICATIONS</span>
              {(notifData?.unread ?? 0) > 0 && (
                <button
                  onClick={async () => { await api.markAllNotificationsRead(); qc.invalidateQueries({ queryKey: ["notifications"] }); }}
                  className="text-xs text-[var(--primary)] underline underline-offset-2"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {(notifData?.items ?? []).length === 0 && (
                <div className="px-3 py-4 text-xs text-[var(--muted-foreground)]">Nothing yet. Mentions, DMs and thread replies land here.</div>
              )}
              {(notifData?.items ?? []).map((n: any) => (
                <button
                  key={n.id}
                  onClick={async () => {
                    setNotifsOpen(false);
                    if (!n.read) { await api.markNotificationRead(n.id); qc.invalidateQueries({ queryKey: ["notifications"] }); }
                    if (n.channelId) setActiveChannel(n.channelId);
                  }}
                  className={`w-full text-left px-3 py-2 border-t border-[var(--border)] first:border-t-0 hover:bg-[var(--muted)] ${n.read ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded ${n.type === "mention" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : n.type === "dm" ? "bg-emerald-600 text-white" : "bg-[var(--muted)] text-[var(--foreground)]"}`}>
                      {n.type}
                    </span>
                    <span className="text-xs truncate flex-1">{n.title}</span>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-[var(--accent)] shrink-0" />}
                  </div>
                  {n.body && <div className="mt-1 text-xs text-[var(--muted-foreground)] line-clamp-2">{n.body}</div>}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* search → command palette */}
      <div className="px-3 pt-3">
        <button
          onClick={() => setPaletteOpen(true)}
          className="w-full flex items-center gap-2 h-8 rounded-lg bg-white/5 border border-white/10 px-2.5 text-xs text-white/40 hover:bg-white/10 hover:text-white/60 transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd className="bg-white/10 border-white/10 text-white/50">Ctrl P</Kbd>
        </button>
      </div>

      {/* scrollable sections */}
      <div className="flex-1 overflow-y-auto pb-2 space-y-0.5">
        <SectionHeader label="CHANNELS" onAdd={() => openDialog("createChannel")} addTitle="Create a channel" />
        <div className="space-y-0.5 px-0">
          {channelList.map((c) => (
            <SidebarButton
              key={c.id}
              active={activeChannelId === c.id}
              onClick={() => setActiveChannel(c.id)}
              unread={!c.lastReadMessageId}
              title={c.name}
            >
              {c.type === "private" ? <Lock className="h-3.5 w-3.5 opacity-70 shrink-0" /> : <Hash className="h-3.5 w-3.5 opacity-70 shrink-0" />}
              <span className="truncate flex-1">{c.name}</span>
            </SidebarButton>
          ))}
          {channelList.length === 0 && (
            <div className="mx-2 text-xs text-white/40">No channels yet.</div>
          )}
        </div>

        <SectionHeader label="DIRECT MESSAGES" onAdd={() => openDialog("newDm")} addTitle="New direct message" />
        <div className="space-y-0.5">
          {dmCandidates.length === 0 && (
            <div className="mx-2 text-xs text-white/40">No other members yet.</div>
          )}
          {dmCandidates.map((m: any) => (
            <SidebarButton key={m.id} active={activeChannelId === dmChannelId(channels, m.id)} onClick={() => openDm(m.id)} title={m.name}>
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-[9px] bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] text-[var(--primary-foreground)]">
                  {String(m.name).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate flex-1">{m.name}</span>
              <span className={`h-2 w-2 rounded-full shrink-0 ${presence[m.id] === "online" ? "bg-emerald-500" : "bg-white/15"}`} />
            </SidebarButton>
          ))}
        </div>

        <SectionHeader label="AI MODELS" onAdd={() => openDialog("llmManager")} addTitle="Connect / manage models" />
        <div className="space-y-0.5">
          {((llmConnections as any[]) ?? []).length === 0 && (
            <div className="mx-2 text-xs text-white/40">No models connected.</div>
          )}
          {((llmConnections as any[]) ?? []).map((c: any) => (
            <SidebarButton key={c.id} onClick={() => openLlmDm(c.id)} title={`${c.modelId} — open chat`}>
              <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] shrink-0">
                <Sparkles className="h-3 w-3" />
              </span>
              <span className="truncate flex-1">{c.label}</span>
              <span className={`ml-auto h-2 w-2 rounded-full shrink-0 ${c.status === "ok" ? "bg-emerald-500" : c.status === "error" ? "bg-red-500" : "bg-amber-500"}`} />
            </SidebarButton>
          ))}
        </div>
      </div>

      {/* notifications popover moved to header bell */}

      {/* account */}
      {(me as any)?.id && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 p-3 border-t border-[var(--sidebar-border)] bg-black/10 text-left hover:bg-black/20 transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] text-[var(--primary-foreground)] text-xs font-bold">
                  {String((me as any).name ?? "U").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{(me as any).name ?? (me as any).email ?? "User"}</span>
                <span className="block text-xs text-emerald-300 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Online</span>
              </span>
              <ChevronDown className="h-4 w-4 text-white/40 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuItem onClick={() => { window.location.href = "/login?switch=1"; }}>
              <ArrowLeftRight /> Switch account
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={async () => { await api.authSignOut(); location.reload(); }}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

    </aside>
  );
}

function dmChannelId(channels: { id: string; type: string; dmPeer?: { id: string } | null }[], userId: string) {
  return channels.find((c) => c.type === "dm" && c.dmPeer?.id === userId)?.id;
}

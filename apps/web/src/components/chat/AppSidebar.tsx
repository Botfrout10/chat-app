"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Bell,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Hash,
  Lock,
  LogOut,
  ArrowLeftRight,
  PanelLeftClose,
  Plus,
  Search,
  Sparkles,
  Sun,
  Moon,
} from "lucide-react";
import { api } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useChatStore } from "@/store/chat";
import { useUiStore, type SidebarSection } from "@/store/ui";
import { useOpenDm, useOpenLlmDm } from "@/hooks/useChatActions";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { useTheme } from "next-themes";

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
      className={cn(
        "text-left rounded-[var(--radius-md)] text-sm flex items-center gap-2 relative w-full px-2 py-1.5",
        active
          ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-soft)]"
          : "text-sidebar-foreground/60 hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground"
      )}
    >
      {children}
      {unread && !active && (
        <span className="h-2 w-2 rounded-full bg-[var(--accent)] ml-auto shrink-0" title="Unread" />
      )}
    </button>
  );
}

function CollapsibleSection({
  sectionKey,
  label,
  onAdd,
  addTitle,
  children,
}: {
  sectionKey: SidebarSection;
  label: string;
  onAdd?: () => void;
  addTitle?: string;
  children: React.ReactNode;
}) {
  const isCollapsed = useUiStore((s) => s.sidebarSections[sectionKey]);
  const toggleSection = useUiStore((s) => s.toggleSection);

  return (
    <Collapsible open={!isCollapsed} onOpenChange={() => toggleSection(sectionKey)}>
      <div className="flex items-center justify-between px-2 pt-4 pb-1">
        <CollapsibleTrigger asChild>
          <button
            className="flex items-center gap-1 text-[11px] font-semibold tracking-widest text-sidebar-foreground/40 hover:text-sidebar-foreground/60 transition-colors"
            title={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")} />
            {label}
          </button>
        </CollapsibleTrigger>
        {onAdd && (
          <button
            onClick={onAdd}
            title={addTitle}
            className="h-5 w-5 rounded-md bg-sidebar-foreground/10 hover:bg-sidebar-foreground/15 border border-sidebar-foreground/10 flex items-center justify-center"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
      <CollapsibleContent>
        <div className="space-y-0.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AppSidebar() {
  const qc = useQueryClient();
  const workspaces = useChatStore((s) => s.workspaces);
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const channels = useChatStore((s) => s.channels);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const presence = useChatStore((s) => s.presence);
  const openDialog = useUiStore((s) => s.openDialog);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const { resolvedTheme, setTheme } = useTheme();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null) });

  // Global DMs — friends, not workspace-bound (like AI Models)
  const { data: globalDms } = useQuery({
    queryKey: ["dms"],
    queryFn: () => (api as any).dms().catch(() => []),
    enabled: !!(me as any)?.id,
  });
  const dmList = ((globalDms as any[]) ?? []) as any[];

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
    <aside
      className={cn(
        "shrink-0 w-[260px] bg-[var(--sidebar-muted)] text-[var(--sidebar-foreground)] hidden md:flex flex-col border-r border-[var(--sidebar-border)] transition-[width] duration-200"
      )}
    >
      {/* header: workspace switcher + actions */}
      <div className="h-14 flex items-center gap-1 border-b border-[var(--sidebar-border)] shrink-0 px-2">
        <WorkspaceSwitcher />
        <button
          onClick={toggleSidebar}
          title="Hide sidebar (Ctrl+B)"
          className="h-7 w-7 shrink-0 rounded-lg bg-sidebar-foreground/10 hover:bg-sidebar-foreground/15 border border-sidebar-foreground/10 flex items-center justify-center text-sidebar-foreground/60"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
        <Popover open={notifsOpen} onOpenChange={setNotifsOpen}>
          <PopoverTrigger asChild>
            <button
              className="relative h-7 w-7 shrink-0 rounded-lg bg-sidebar-foreground/10 hover:bg-sidebar-foreground/15 border border-sidebar-foreground/10 flex items-center justify-center"
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
      <div className="px-2 pt-3">
        <button
          onClick={() => setPaletteOpen(true)}
          className="w-full flex items-center gap-2 h-8 rounded-lg bg-sidebar-foreground/5 border border-sidebar-foreground/10 px-2.5 text-xs text-sidebar-foreground/40 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground/60 transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd className="bg-sidebar-foreground/10 border-sidebar-foreground/10 text-sidebar-foreground/50">Ctrl P</Kbd>
        </button>
      </div>

      {/* scrollable sections */}
      <div className="flex-1 overflow-y-auto pb-2 px-2">
        <CollapsibleSection sectionKey="channels" label="CHANNELS" onAdd={() => openDialog("createChannel")} addTitle="Create a channel">
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
            <div className="px-2 text-xs text-sidebar-foreground/40">No channels yet.</div>
          )}
        </CollapsibleSection>

        <CollapsibleSection sectionKey="dms" label="DIRECT MESSAGES" onAdd={() => openDialog("newDm")} addTitle="Add friend">
          {dmList.length === 0 && (
            <div className="px-2 text-xs text-sidebar-foreground/40">No friends yet. Add a friend to start.</div>
          )}
          {dmList.map((ch: any) => {
            const peer = ch.dmPeer ?? ch.peer;
            if (!peer) return null;
            return (
              <SidebarButton
                key={ch.id}
                active={activeChannelId === ch.id}
                onClick={() => setActiveChannel(ch.id)}
                title={peer.name ?? peer.email}
              >
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[9px] bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] text-[var(--primary-foreground)]">
                    {String(peer.name ?? "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate flex-1">{peer.name ?? peer.email}</span>
                <span className={cn("h-2 w-2 rounded-full shrink-0", presence[peer.id] === "online" ? "bg-emerald-500" : "bg-sidebar-foreground/15")} />
              </SidebarButton>
            );
          })}
        </CollapsibleSection>

        <CollapsibleSection sectionKey="ai" label="AI MODELS" onAdd={() => openDialog("llmManager")} addTitle="Connect / manage models">
          {((llmConnections as any[]) ?? []).length === 0 && (
            <div className="px-2 text-xs text-sidebar-foreground/40">No models connected.</div>
          )}
          {((llmConnections as any[]) ?? []).map((c: any) => (
            <SidebarButton key={c.id} onClick={() => openLlmDm(c.id)} title={`${c.modelId} — open chat`}>
              <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] shrink-0">
                <Sparkles className="h-3 w-3" />
              </span>
              <span className="truncate flex-1">{c.label}</span>
              <span className={cn("h-2 w-2 rounded-full shrink-0", c.status === "ok" ? "bg-emerald-500" : c.status === "error" ? "bg-red-500" : "bg-amber-500")} />
            </SidebarButton>
          ))}
        </CollapsibleSection>
      </div>

      {/* account */}
      {(me as any)?.id && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-2 border-t border-[var(--sidebar-border)] bg-sidebar-foreground/5 text-left hover:bg-sidebar-foreground/10 transition-colors shrink-0 p-3"
              )}
              title={(me as any).name}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] text-[var(--primary-foreground)] text-xs font-bold">
                  {String((me as any).name ?? "U").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{(me as any).name ?? (me as any).email ?? "User"}</span>
                <span className="block text-xs text-emerald-600 dark:text-emerald-300 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Online</span>
              </span>
              <ChevronDown className="h-4 w-4 text-sidebar-foreground/40 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
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

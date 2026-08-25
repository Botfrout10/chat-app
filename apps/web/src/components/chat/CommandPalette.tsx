"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AtSign,
  BrainCircuit,
  CornerDownLeft,
  Hash,
  Lock,
  LogOut,
  MessageSquarePlus,
  Plus,
  Search,
  Sparkles,
  UserPlus,
  Users,
  FolderPlus,
} from "lucide-react";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";
import { useOpenDm, useOpenLlmDm } from "@/hooks/useChatActions";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openDialog } = useUiStore();
  const { workspaces, activeWorkspaceId, channels, setActiveChannel, setActiveWorkspace } = useChatStore();
  const openDm = useOpenDm();
  const openLlmDm = useOpenLlmDm();

  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "k")) {
        e.preventDefault();
        setPaletteOpen(!useUiStore.getState().paletteOpen);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  // debounce message search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null), enabled: paletteOpen });
  const { data: members } = useQuery({
    queryKey: ["members", activeWorkspaceId],
    queryFn: () => api.members(activeWorkspaceId!).catch(() => []),
    enabled: paletteOpen && !!activeWorkspaceId,
  });
  const { data: llmConnections } = useQuery({
    queryKey: ["llm-connections"],
    queryFn: () => api.llmConnections().catch(() => []),
    enabled: paletteOpen,
  });
  const { data: searchRes } = useQuery({
    queryKey: ["palette-search", debouncedQ],
    queryFn: () => api.search(debouncedQ).catch(() => []),
    enabled: paletteOpen && debouncedQ.length >= 3,
  });

  const dmCandidates = useMemo(
    () => ((members as any[]) ?? []).filter((m) => m.id !== (me as any)?.id),
    [members, me],
  );

  function close() { setPaletteOpen(false); setQuery(""); setDebouncedQ(""); }

  function go(channelId?: string | null) {
    if (channelId) setActiveChannel(channelId);
    close();
  }

  const runAction = (fn: () => void) => { close(); fn(); };

  return (
    <CommandDialog open={paletteOpen} onOpenChange={(v) => (v ? setPaletteOpen(true) : close())} className="sm:max-w-xl">
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search channels, people, messages — or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Navigate: channels */}
        {channels.some((c) => c.type !== "dm") && (
          <CommandGroup heading="Channels">
            {channels.filter((c) => c.type !== "dm").map((c) => (
              <CommandItem key={c.id} value={`channel ${c.name}`} onSelect={() => go(c.id)}>
                {c.type === "private" ? <Lock /> : <Hash />}
                <span>{c.name}</span>
                <CornerDownLeft className="ml-auto opacity-0 group-data-[selected=true]/command-item:opacity-100" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* People → DMs */}
        {dmCandidates.length > 0 && (
          <CommandGroup heading="Direct messages">
            {dmCandidates.map((m: any) => {
              const existing = channels.find((c) => c.type === "dm" && c.dmPeer?.id === m.id);
              return (
                <CommandItem key={m.id} value={`dm ${m.name} ${m.email ?? ""}`} onSelect={() => runAction(() => go(existing?.id))}>
                  <AtSign />
                  <span>{m.name}</span>
                  <span className="ml-auto text-xs text-[var(--muted-foreground)] truncate max-w-[160px]">{existing ? "open chat" : m.email}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* AI models */}
        {((llmConnections as any[]) ?? []).length > 0 && (
          <CommandGroup heading="AI models">
            {((llmConnections as any[]) ?? []).map((c: any) => {
              const existing = channels.find((ch) => ch.llmConnectionId === c.id);
              return (
                <CommandItem key={c.id} value={`model ${c.label}`} onSelect={() => runAction(() => openLlmDm(c.id).then(() => {}))}>
                  <Sparkles />
                  <span>{c.label}</span>
                  <span className="ml-auto text-xs text-[var(--muted-foreground)]">{existing ? "chat" : `@${c.mentionName}`}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Message search results */}
        {(searchRes as any[])?.length > 0 && debouncedQ.length >= 3 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Messages matching “${debouncedQ}”`}>
              {(searchRes as any[]).slice(0, 8).map((r: any) => (
                <CommandItem key={r.id} value={`message ${r.id} ${r.content}`} onSelect={() => go(r.channelId ?? r.channel?.id)} className="gap-2">
                  <Search className="shrink-0" />
                  <span className="truncate flex-1">{r.content}</span>
                  <span className="text-xs text-[var(--muted-foreground)] shrink-0">#{r.channel?.name ?? ""}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Actions */}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="create workspace new" onSelect={() => runAction(() => openDialog("createWorkspace"))}>
            <FolderPlus /> Create workspace
          </CommandItem>
          <CommandItem value="create channel new" onSelect={() => runAction(() => openDialog("createChannel"))}>
            <Plus /> Create channel
          </CommandItem>
          <CommandItem value="new direct message dm" onSelect={() => runAction(() => openDialog("newDm"))}>
            <MessageSquarePlus /> New direct message
          </CommandItem>
          <CommandItem value="invite add member people" onSelect={() => runAction(() => openDialog("inviteMember"))}>
            <UserPlus /> Invite members
          </CommandItem>
          <CommandItem value="connect ai model llm manage" onSelect={() => runAction(() => openDialog("llmManager"))}>
            <BrainCircuit /> Manage AI models
          </CommandItem>
        </CommandGroup>

        {/* Switch workspace */}
        {workspaces.length > 1 && (
          <CommandGroup heading="Switch workspace">
            {workspaces.map((w) => (
              <CommandItem key={w.id} value={`workspace ${w.name}`} onSelect={() => runAction(() => setActiveWorkspace(w.id))}>
                <Users />
                <span>{w.name}</span>
                {w.id === activeWorkspaceId && <span className="ml-auto text-xs text-[var(--muted-foreground)]">current</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Account">
          <CommandItem value="sign out logout" onSelect={() => runAction(async () => { await api.authSignOut(); location.reload(); })}>
            <LogOut /> Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

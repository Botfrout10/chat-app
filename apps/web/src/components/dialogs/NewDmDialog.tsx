"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";
import { useOpenDm, useOpenDmByEmail } from "@/hooks/useChatActions";

export function NewDmDialog() {
  const { dialog, closeDialog } = useUiStore();
  const open = dialog === "newDm";
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const openDm = useOpenDm();
  const openDmByEmail = useOpenDmByEmail();
  const [query, setQuery] = useState("");

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null), enabled: open });
  const { data: members } = useQuery({
    queryKey: ["members", activeWorkspaceId],
    queryFn: () => api.members(activeWorkspaceId!).catch(() => []),
    enabled: open && !!activeWorkspaceId,
  });
  const candidates = useMemo(
    () => ((members as any[]) ?? []).filter((m) => m.id !== (me as any)?.id),
    [members, me],
  );

  // Global fallback search — best column is email (unique), then name
  const q = query.trim();
  const isEmailLike = q.includes("@") && q.includes(".");
  const { data: globalUsers } = useQuery({
    queryKey: ["user-search", q],
    queryFn: () => (api as any).searchUsers(q).catch(() => []),
    enabled: open && q.length >= 2,
  });
  const globalCandidates = useMemo(() => {
    const list = ((globalUsers as any[]) ?? []).filter((u: any) => u.id !== (me as any)?.id);
    // de-dupe against workspace candidates
    const wsIds = new Set(candidates.map((m: any) => m.id));
    return list.filter((u: any) => !wsIds.has(u.id));
  }, [globalUsers, candidates, me]);

  async function pick(userId: string) {
    closeDialog();
    setQuery("");
    await openDm(userId);
  }
  async function pickEmail(email: string) {
    closeDialog();
    setQuery("");
    await openDmByEmail(email);
  }

  // reset query when dialog closes
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      closeDialog();
      setQuery("");
    }
  };

  const showEmailAdd = isEmailLike && q.length >= 5 && !candidates.some((m: any) => String(m.email).toLowerCase() === q.toLowerCase()) && !globalCandidates.some((m: any) => String(m.email).toLowerCase() === q.toLowerCase());

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Add friend</DialogTitle>
          <DialogDescription>Search workspace members or type exact email to add a friend globally.</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search workspace members or type exact email…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-72">
            <CommandEmpty>
              {q ? `No workspace match for "${q}". Try exact email.` : "No members found."}
            </CommandEmpty>
            {candidates.length > 0 && (
              <CommandGroup heading="Workspace members">
                {candidates
                  .filter((m: any) => !q || `${m.name} ${m.email}`.toLowerCase().includes(q.toLowerCase()))
                  .map((m: any) => (
                    <CommandItem key={m.id} value={`${m.name} ${m.email}`} onSelect={() => pick(m.id)} className="gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px]">{String(m.name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{m.name}</span>
                      <span className="ml-auto text-xs text-[var(--muted-foreground)] truncate max-w-[160px]">{m.email}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            )}
            {globalCandidates.length > 0 && (
              <CommandGroup heading="Global search (email is best)">
                {globalCandidates.map((m: any) => (
                  <CommandItem key={m.id} value={`${m.name} ${m.email}`} onSelect={() => pick(m.id)} className="gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-[10px]">{String(m.name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{m.name}</span>
                    <span className="ml-auto text-xs text-[var(--muted-foreground)] truncate max-w-[160px]">{m.email}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showEmailAdd && (
              <CommandGroup heading="Add by email">
                <CommandItem value={q} onSelect={() => pickEmail(q)} className="gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px]">+</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">Add friend by email</span>
                  <span className="ml-auto text-xs text-[var(--muted-foreground)] truncate max-w-[160px]">{q}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

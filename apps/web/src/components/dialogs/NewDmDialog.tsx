"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";
import { useOpenDm } from "@/hooks/useChatActions";

export function NewDmDialog() {
  const { dialog, closeDialog } = useUiStore();
  const open = dialog === "newDm";
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const openDm = useOpenDm();

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

  async function pick(userId: string) {
    closeDialog();
    await openDm(userId);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeDialog()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>New direct message</DialogTitle>
          <DialogDescription>Pick a workspace member to start a private conversation.</DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Search members…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No members found.</CommandEmpty>
            <CommandGroup>
              {candidates.map((m: any) => (
                <CommandItem key={m.id} value={`${m.name} ${m.email}`} onSelect={() => pick(m.id)} className="gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px]">{String(m.name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{m.name}</span>
                  <span className="ml-auto text-xs text-[var(--muted-foreground)] truncate max-w-[160px]">{m.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

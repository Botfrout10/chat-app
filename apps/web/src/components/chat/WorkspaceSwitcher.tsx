"use client";
import { Check, ChevronsUpDown, Plus, UserPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, setActiveWorkspace } = useChatStore();
  const openDialog = useUiStore((s) => s.openDialog);
  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 -mx-1 text-left hover:bg-white/5 transition-colors"
          title="Switch workspace"
        >
          <span className="h-8 w-8 rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)] text-xs font-bold shrink-0">
            {(active?.name ?? "W").slice(0, 2).toUpperCase()}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold truncate">{active?.name ?? "Select workspace"}</span>
            <span className="block text-[11px] text-white/40">{workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-white/40 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => setActiveWorkspace(w.id)}>
            <span className="h-5 w-5 rounded-md bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[9px] font-bold text-[var(--primary-foreground)]">
              {w.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="truncate flex-1">{w.name}</span>
            {w.id === activeWorkspaceId && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openDialog("createWorkspace")}>
          <Plus /> Create workspace
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openDialog("inviteMember")}>
          <UserPlus /> Invite members
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function CreateWorkspaceDialog() {
  const { dialog, closeDialog } = useUiStore();
  const open = dialog === "createWorkspace";
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const setActiveWorkspace = useChatStore((s) => s.setActiveWorkspace);
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    setBusy(true);
    try {
      await api.createWorkspace(trimmed);
      const data: any[] = await qc.fetchQuery({ queryKey: ["workspaces"], queryFn: () => api.workspaces() });
      useChatStore.getState().setWorkspaces(data);
      const newest = data[data.length - 1];
      if (newest) setActiveWorkspace(newest.id);
      toast.success(`Workspace “${trimmed}” created`);
      setName("");
      closeDialog();
    } catch (e: any) {
      toast.error((e.message?.slice(0, 200)) ?? "Failed to create workspace");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeDialog()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>A workspace holds your team, channels and conversations.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name (2–50 characters)"
            maxLength={50}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog}>Cancel</Button>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? "Creating…" : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Hash } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, "-").replace(/--+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

export function CreateChannelDialog() {
  const { dialog, closeDialog } = useUiStore();
  const open = dialog === "createChannel";
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspaceId) return;
    const normalized = slugify(name);
    if (normalized.length < 2) return;
    setBusy(true);
    try {
      await api.createChannel(activeWorkspaceId, { name: normalized, type: isPrivate ? "private" : "public" });
      const chs: any[] = await qc.fetchQuery({
        queryKey: ["channels", activeWorkspaceId],
        queryFn: () => api.channels(activeWorkspaceId),
      });
      useChatStore.getState().setChannels(chs);
      const newest = chs[chs.length - 1];
      if (newest) setActiveChannel(newest.id);
      toast.success(`Channel #${normalized} created`);
      setName("");
      setIsPrivate(false);
      closeDialog();
    } catch (e: any) {
      const msg = e.message ?? "";
      if (/unique|duplicate/i.test(msg)) toast.error("Channel name already exists in this workspace");
      else toast.error(msg.slice(0, 200) || "Failed to create channel");
    } finally {
      setBusy(false);
    }
  }

  const normalized = slugify(name);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeDialog()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>
            Channels organize conversations by topic. {isPrivate ? "Only invited members can see private channels." : "Everyone in the workspace can join public channels."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. general, project-x"
            />
            {normalized && (
              <p className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                {isPrivate ? <Lock className="h-3 w-3" /> : <Hash className="h-3 w-3" />}
                {normalized}
              </p>
            )}
          </div>
          <label className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <span className="space-y-0.5">
              <span className="block text-sm font-medium flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Private</span>
              <span className="block text-xs text-[var(--muted-foreground)]">Invite only — hidden from non-members.</span>
            </span>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog}>Cancel</Button>
            <Button type="submit" disabled={busy || normalized.length < 2}>
              {busy ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

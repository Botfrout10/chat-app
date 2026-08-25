"use client";
import { useState } from "react";
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

export function InviteMemberDialog() {
  const { dialog, closeDialog } = useUiStore();
  const open = dialog === "inviteMember";
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspaceId || !query.trim()) return;
    const q = query.trim();
    setBusy(true);
    try {
      // 1st: add existing user by exact name or email
      const added: any = await api.addMember(activeWorkspaceId, q);
      toast.success(`Added ${added.name}`);
      setQuery("");
      closeDialog();
    } catch (e: any) {
      const raw = e.message ?? "";
      let body = raw;
      try { body = JSON.parse(raw)?.error ?? raw; } catch {}
      const isNotFound = body.includes("USER_NOT_FOUND") || /No registered user/i.test(body);
      if (isNotFound && q.includes("@")) {
        // fallback: email invite for someone not signed up yet
        try {
          const inv: any = await api.invite(activeWorkspaceId, q, "member");
          const link = inv.inviteUrl ?? `/invite/${inv.token}`;
          try {
            await navigator.clipboard.writeText(link.startsWith("http") ? link : `${location.origin}${link}`);
            toast.success("Invite created — link copied to clipboard");
          } catch {
            toast.success(`Invite created — share link ${link}`);
          }
          setQuery("");
          closeDialog();
        } catch (e2: any) {
          toast.error((e2.message ?? "Invite failed").slice(0, 200));
        }
        return;
      }
      if (/already a member/i.test(body)) { toast.error(body); return; }
      if (isNotFound) { toast.error(`No user “${q}” found — ask them to sign up first.`); return; }
      toast.error(body.slice(0, 200) || "Failed to add member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeDialog()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
          <DialogDescription>
            Add a registered user by exact name or email. Unknown emails get an invite link instead.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or email"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog}>Cancel</Button>
            <Button type="submit" disabled={busy || !query.trim()}>
              {busy ? "Working…" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

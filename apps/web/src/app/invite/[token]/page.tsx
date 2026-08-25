"use client";

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/chat";

function InviteInner() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? "");
  const router = useRouter();
  const qc = useQueryClient();
  const setActiveWorkspace = useChatStore((s) => s.setActiveWorkspace);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null) });

  const q = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.inviteMeta(token),
    enabled: !!token,
    retry: false,
  });

  const m = useMutation({
    mutationFn: () => api.acceptInvite(token),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["channels"] });
      if (res?.workspaceId) setActiveWorkspace(res.workspaceId);
      router.replace("/");
    },
  });

  const meta: any = q.data;
  const isExpired = meta?.isExpired;
  const isAccepted = meta?.isAccepted;
  const alreadyMember = meta?.alreadyMember;

  let body: React.ReactNode;

  if (q.isLoading) {
    body = <div className="text-sm text-[var(--muted-foreground)]">Loading invite…</div>;
  } else if ((q.error as any) || !meta) {
    const raw = String((q.error as any)?.message ?? "");
    const notFound = raw.includes("Invite not found") || raw.includes("404");
    body = (
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">{notFound ? "This invite was not found or was revoked." : raw.slice(0, 300)}</p>
        <Link href="/" className="text-sm text-[var(--primary)] underline">Back to Pulse</Link>
      </div>
    );
  } else if (isExpired) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">This invite expired on {new Date(meta.expiresAt).toLocaleDateString()}.</p>
        <p className="text-sm text-[var(--muted-foreground)]">Ask a workspace admin to send a new one.</p>
        <Link href="/" className="text-sm text-[var(--primary)] underline">Back to Pulse</Link>
      </div>
    );
  } else if (isAccepted && !alreadyMember) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">This invite has already been used.</p>
        {!me?.id ? (
          <Link href={`/login?redirect=/invite/${encodeURIComponent(token)}`} className="inline-flex h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm items-center">Sign in</Link>
        ) : (
          <Link href="/" className="text-sm text-[var(--primary)] underline">Go to workspace</Link>
        )}
      </div>
    );
  } else if (alreadyMember) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">You’re already in <b className="text-[var(--foreground)]">{meta.workspace.name}</b>.</p>
        <Button onClick={() => { setActiveWorkspace(meta.workspace.id); router.replace("/"); }} className="w-full">Open workspace</Button>
      </div>
    );
  } else if (!(me as any)?.id) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-foreground)]">You’ve been invited to join <b className="text-[var(--foreground)]">{meta.workspace.name}</b> as <span className="inline-flex px-2 py-0.5 rounded-full bg-[var(--accent-100)] text-[var(--accent-700)] text-xs">{meta.role}</span>.</p>
        <p className="text-xs text-[var(--muted-foreground)]">Invite for {meta.email} · expires {new Date(meta.expiresAt).toLocaleDateString()}</p>
        <div className="flex gap-2">
          <Link href={`/login?redirect=/invite/${encodeURIComponent(token)}`} className="flex-1 h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm inline-flex items-center justify-center">Sign in to accept</Link>
          <Link href={`/login?mode=signup&redirect=/invite/${encodeURIComponent(token)}`} className="flex-1 h-9 px-4 rounded-[var(--radius-sm)] border border-[var(--border)] text-sm inline-flex items-center justify-center">Create account</Link>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted-foreground)]">You’re invited to <b className="text-[var(--foreground)]">{meta.workspace.name}</b> as <span className="inline-flex px-2 py-0.5 rounded-full bg-[var(--accent-100)] text-[var(--accent-700)] text-xs">{meta.role}</span>.</p>
        <p className="text-xs text-[var(--muted-foreground)]">Invite for {meta.email}</p>
        <Button onClick={() => m.mutate()} disabled={m.isPending} className="w-full">{m.isPending ? "Joining…" : `Accept invite — Join ${meta.workspace.name}`}</Button>
        {m.error ? <p className="text-sm text-red-600">{String((m.error as any)?.message ?? "Failed").slice(0, 300)}</p> : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      <header className="h-14 border-b border-[var(--border)] bg-[var(--card)] px-4 flex items-center">
        <Link href="/" className="flex items-center gap-2 font-semibold text-[var(--foreground)]">
          <span className="h-8 w-8 rounded-xl bg-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] text-sm font-bold">P</span> Pulse
        </Link>
      </header>
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)] font-bold">✦</div>
          <h1 className="text-lg font-semibold text-[var(--foreground)]">Workspace invite</h1>
          {meta?.workspace ? <p className="text-xs text-[var(--muted-foreground)]">/{meta.workspace.slug} · {token.slice(0, 10)}…</p> : null}
          <div className="pt-2">{body}</div>
        </div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <InviteInner />
    </Suspense>
  );
}

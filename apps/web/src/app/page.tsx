"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppShell } from "@/components/chat/AppShell";

function HeaderActions() {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me().catch(() => null),
  });

  if (isLoading) return <div className="h-8 w-24 rounded-full bg-[var(--muted)] animate-pulse" />;

  if (me?.id) {
    return (
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 text-sm">
          <span className="h-8 w-8 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)] text-xs font-bold">
            {(me.name ?? me.email ?? "U").slice(0, 2).toUpperCase()}
          </span>
          <span className="text-[var(--foreground)] font-medium max-w-[140px] truncate">{me.name ?? me.email}</span>
        </div>
        <Link href="/login" className="hidden sm:inline-flex h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] items-center">
          Switch account
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--muted-foreground)] hidden md:inline">MinIO • Postgres • Redis • Socket.IO • Drizzle • Bun</span>
      <Link href="/login" className="h-8 px-4 rounded-[var(--radius-sm)] bg-[var(--secondary)] text-[var(--secondary-foreground)] text-sm font-medium inline-flex items-center hover:opacity-90">
        Sign in
      </Link>
      <Link href="/login?mode=signup" className="h-8 px-4 rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium inline-flex items-center hover:bg-[var(--primary-hover)] shadow-[var(--shadow-soft)]">
        Create account
      </Link>
    </div>
  );
}

export default function Home() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me().catch(() => null),
  });
  const isAuthed = !!me?.id;

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-[var(--background)]">
      <header className="h-14 border-b border-[var(--border)] bg-[var(--card)]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto h-full px-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)] font-bold text-sm shadow-[var(--shadow-soft)]">P</div>
            <span className="font-semibold tracking-tight text-[var(--foreground)]">Pulse</span>
            <span className="text-xs text-[var(--muted-foreground)] hidden sm:inline">Team chat — warm, fast, honest</span>
          </Link>
          <HeaderActions />
        </div>
      </header>

      <div className="flex-1 flex flex-col">
        <div className={`flex-1 grid min-h-[calc(100vh-56px)] ${isAuthed ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[420px_1fr]"}`}>
          {!isAuthed && (
            <div className="hidden lg:flex flex-col p-6 gap-6 bg-gradient-to-br from-[#2b1d0f] via-[#4a2d0a] to-[#b7791f] text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(212,162,78,0.18),transparent_55%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(255,251,240,0.08),transparent_40%)]" />
              <div className="relative">
                <h1 className="text-3xl font-bold tracking-tight leading-tight">
                  Where teams
                  <br />
                  actually talk.
                </h1>
                <p className="mt-3 text-sm text-amber-100/90 leading-relaxed">
                  Real-time, thread-aware, searchable. Built with cursor pagination, Redis pub/sub, MinIO attachments, and Socket.IO scaling — the serious engineering behind a simple chat box.
                </p>
              </div>

              <div className="relative mt-2 rounded-[var(--radius)] bg-white/10 backdrop-blur border border-white/15 p-4 space-y-3 shadow-[var(--shadow-card)]">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-100">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Live preview
                </div>
                <div className="space-y-2">
                  <div className="rounded-xl bg-white text-[#2b1d0f] p-3 text-sm shadow-sm">
                    <div className="text-xs text-[#6b5a44]"># general</div>
                    <div className="mt-1 font-medium">Alice — Hey team, deployment failed on staging</div>
                    <div className="text-xs text-[#6b5a44] mt-1">Bob is typing…</div>
                  </div>
                  <div className="rounded-xl bg-[#1c120a] text-amber-50 p-3 text-sm border border-white/10">
                    <div className="text-xs text-amber-200/70"># project-x</div>
                    <div className="mt-1">Thread replies, reactions, edits, mentions, and file drops — all real-time.</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-white/10 border border-white/10 p-3">✓ Cursor pagination<br />ULID ordering</div>
                  <div className="rounded-xl bg-white/10 border border-white/10 p-3">✓ Redis pub/sub<br />3-server fanout</div>
                  <div className="rounded-xl bg-white/10 border border-white/10 p-3">✓ MinIO presigned<br />attachments</div>
                  <div className="rounded-xl bg-white/10 border border-white/10 p-3">✓ Presence + typing<br />read receipts</div>
                </div>
              </div>

              <div className="relative mt-auto text-xs text-amber-200/80 space-y-1">
                <div>Phase 1 → Foundation • Phase 2 → Realtime • Phase 3 → Threads • Phase 4 → Workers • Phase 5 → Scale</div>
                <div className="text-amber-100/70">Run `docker compose up` and open 2 browsers to see sync.</div>
              </div>
            </div>
          )}

          <AppShell />
        </div>
      </div>
    </div>
  );
}

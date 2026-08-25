"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api } from "@/lib/api";
import { AppShell } from "@/components/chat/AppShell";

function HeaderActions() {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me().catch(() => null),
  });

  if (isLoading) return <div className="h-8 w-24 rounded-full bg-[var(--muted)] animate-pulse" />;
  if ((me as any)?.id) return null;

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
  const isAuthed = !!(me as any)?.id;

  return (
    <div className="flex flex-col flex-1 h-screen overflow-hidden bg-[var(--background)]">

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className={`flex-1 grid min-h-0 overflow-hidden ${isAuthed ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[420px_1fr]"}`}>
          {!isAuthed && (
            <div className="hidden lg:flex flex-col p-6 gap-6 bg-gradient-to-br from-[#04211f] via-[#0a3d38] to-[#0f766e] text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(45,212,191,0.16),transparent_55%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(240,253,250,0.08),transparent_40%)]" />
              <div className="relative">
                <h1 className="text-3xl font-bold tracking-tight leading-tight">
                  Where teams
                  <br />
                  actually talk.
                </h1>
                <p className="mt-3 text-sm text-teal-100/90 leading-relaxed">
                  Real-time, thread-aware, searchable. Built with cursor pagination, Redis pub/sub, MinIO attachments, and Socket.IO scaling — the serious engineering behind a simple chat box.
                </p>
              </div>

              <div className="relative mt-2 rounded-[var(--radius)] bg-white/10 backdrop-blur border border-white/15 p-4 space-y-3 shadow-[var(--shadow-card)]">
                <div className="flex items-center gap-2 text-xs font-medium text-teal-100">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Live preview
                </div>
                <div className="space-y-2">
                  <div className="rounded-xl bg-white text-[#0c1a19] p-3 text-sm shadow-sm">
                    <div className="text-xs text-[#5b6f6d]"># general</div>
                    <div className="mt-1 font-medium">Alice — Hey team, deployment failed on staging</div>
                    <div className="text-xs text-[#5b6f6d] mt-1">Bob is typing…</div>
                  </div>
                  <div className="rounded-xl bg-[#081413] text-teal-50 p-3 text-sm border border-white/10">
                    <div className="text-xs text-teal-200/70"># project-x</div>
                    <div className="mt-1">Thread replies, reactions, edits, mentions, and file drops — all real-time.</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-white/10 border border-white/10 p-3 inline-flex"><Check className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" /><span>Cursor pagination<br />ULID ordering</span></div>
                  <div className="rounded-xl bg-white/10 border border-white/10 p-3 inline-flex"><Check className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" /><span>Redis pub/sub<br />3-server fanout</span></div>
                  <div className="rounded-xl bg-white/10 border border-white/10 p-3 inline-flex"><Check className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" /><span>MinIO presigned<br />attachments</span></div>
                  <div className="rounded-xl bg-white/10 border border-white/10 p-3 inline-flex"><Check className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" /><span>Presence + typing<br />read receipts</span></div>
                </div>
              </div>

              <div className="relative mt-auto text-xs text-teal-200/80 space-y-1">
                <div>Phase 1 → Foundation • Phase 2 → Realtime • Phase 3 → Threads • Phase 4 → Workers • Phase 5 → Scale</div>
                <div className="text-teal-100/70">Run `docker compose up` and open 2 browsers to see sync.</div>
              </div>
            </div>
          )}

          <AppShell />
        </div>
      </div>
    </div>
  );
}

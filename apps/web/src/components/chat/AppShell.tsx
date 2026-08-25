"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { Button, Input } from "@/components/ui/button";
import { ChannelView } from "./ChannelView";
import { getSocket, connectSocket } from "@/lib/socket";

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, "-").replace(/--+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

export function AppShell() {
  const { workspaces, activeWorkspaceId, channels, activeChannelId, setWorkspaces, setActiveWorkspace, setChannels, setActiveChannel } = useChatStore();
  const [newWsName, setNewWsName] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [wsError, setWsError] = useState<string | null>(null);
  const [chError, setChError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState<any[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [memberMsg, setMemberMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null) });
  const qc = useQueryClient();

  // notifications (poll + realtime)
  const [showNotifs, setShowNotifs] = useState(false);
  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications().catch(() => ({ items: [], unread: 0 })),
    refetchInterval: 20000,
    enabled: !!me?.id,
  });
  useEffect(() => {
    if (!me?.id) return;
    const s = getSocket();
    const h = () => qc.invalidateQueries({ queryKey: ["notifications"] });
    s.on("notification:new", h);
    return () => { s.off("notification:new", h); };
  }, [me, qc]);

  // load workspaces
  useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const data = await api.workspaces().catch(() => []);
      setWorkspaces(data as any);
      if (!activeWorkspaceId && (data as any)?.[0]) setActiveWorkspace((data as any)[0].id);
      return data;
    },
  });

  // load channels when workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) return;
    api.channels(activeWorkspaceId).then((chs: any) => {
      setChannels(chs as any);
      if (!activeChannelId && (chs as any)?.[0]) setActiveChannel((chs as any)[0].id);
    }).catch(() => setChannels([]));
  }, [activeWorkspaceId]);

  // connect socket when logged in
  useEffect(() => { if (me?.id) connectSocket(); }, [me]);

  // presence
  const [presence, setPresence] = useState<Record<string, string>>({});
  useEffect(() => {
    const s = getSocket();
    const h = (p: any) => setPresence((prev) => ({ ...prev, [p.userId]: p.status }));
    s.on("presence:update", h);
    s.emit("presence:list");
    s.on("presence:list", (list: any[]) => {
      const map: Record<string, string> = {};
      for (const p of list) map[p.userId] = p.status;
      setPresence(map);
    });
    return () => { s.off("presence:update", h); };
  }, []);

  async function createWorkspace() {
    setWsError(null);
    const name = newWsName.trim();
    if (!name) { setWsError("Name required (2-50 chars)"); return; }
    if (name.length < 2) { setWsError("At least 2 characters"); return; }
    try {
      await api.createWorkspace(name);
      setNewWsName("");
      const data = await api.workspaces();
      setWorkspaces(data as any);
      if ((data as any)?.[0] && !activeWorkspaceId) setActiveWorkspace((data as any)[0].id);
      // auto-select new
      const newest = (data as any)?.[data.length - 1];
      if (newest) setActiveWorkspace(newest.id);
    } catch (e: any) {
      setWsError(e.message?.slice(0, 200) ?? "Failed to create workspace");
    }
  }

  async function createChannel() {
    setChError(null);
    if (!activeWorkspaceId) { setChError("Select a workspace first"); return; }
    const raw = newChannelName.trim();
    if (!raw) { setChError("Channel name required"); return; }
    const normalized = slugify(raw);
    if (normalized.length < 2) { setChError("Use 2+ letters, a-z 0-9 - _ only (spaces become -)"); return; }
    try {
      await api.createChannel(activeWorkspaceId, { name: normalized, type: "public" });
      setNewChannelName("");
      const chs = await api.channels(activeWorkspaceId);
      setChannels(chs as any);
      const newest = (chs as any)?.[chs.length - 1];
      if (newest) setActiveChannel(newest.id);
    } catch (e: any) {
      const msg = e.message ?? "";
      if (msg.includes("unique") || msg.includes("duplicate")) setChError("Channel name already exists in this workspace");
      else setChError(msg.slice(0, 200) || "Failed to create channel");
    }
  }

  async function doSearch() {
    if (!searchQ.trim()) return setSearchRes([]);
    const res = await api.search(searchQ.trim()).catch(() => []);
    setSearchRes(res as any);
  }

  async function doInvite() {
    setInviteError(null);
    if (!activeWorkspaceId || !inviteEmail.trim()) { setInviteError("Name or email required"); return; }
    const q = inviteEmail.trim();
    try {
      // 1st: add existing user by exact name or email
      const added: any = await api.addMember(activeWorkspaceId, q);
      setMemberMsg({ kind: "ok", text: `Added ${added.name} ✓` });
      setInviteEmail("");
      return;
    } catch (e: any) {
      const raw = e.message ?? "";
      let body = raw;
      try { body = JSON.parse(raw)?.error ?? raw; } catch {}
      const isNotFound = body.includes("USER_NOT_FOUND") || raw.includes("USER_NOT_FOUND") || /No registered user/i.test(body);
      if (isNotFound && q.includes("@")) {
        // fallback: email invite for someone not signed up yet
        try {
          const inv: any = await api.invite(activeWorkspaceId, q, "member");
          setMemberMsg({ kind: "ok", text: `Invite created — share link ${inv.inviteUrl ?? "/invite/" + inv.token}` });
          setInviteEmail("");
        } catch (e2: any) {
          setInviteError((e2.message ?? "Invite failed").slice(0, 200));
        }
        return;
      }
      if (/already a member/i.test(body)) { setInviteError(body); return; }
      if (isNotFound) { setInviteError(`No user “${q}” found — ask them to sign up first.`); return; }
      setInviteError(body.slice(0, 200) || "Failed to add member");
    }
  }

  if (!me?.id) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--muted)] p-4">
        <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-soft)] text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)]">✦</div>
          <h2 className="mt-3 text-lg font-semibold text-[var(--foreground)]">Sign in to continue</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">Create a workspace, invite your team, start talking.</p>
          <div className="mt-4 flex gap-2 justify-center">
            <a href="/login" className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-foreground)] inline-flex items-center text-sm font-medium">Sign in</a>
            <a href="/login?mode=signup" className="h-9 px-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] inline-flex items-center text-sm">Create account</a>
          </div>
          <div className="mt-4 text-xs text-[var(--muted-foreground)]">Tip: `docker compose up -d` → Postgres, Redis, MinIO ready.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--background)]">
      {/* workspace rail */}
      <div className="w-[64px] shrink-0 bg-[var(--sidebar)] flex flex-col items-center py-4 gap-3 border-r border-[var(--sidebar-border)] hidden sm:flex">
        {workspaces.map((w) => (
          <button
            key={w.id}
            onClick={() => setActiveWorkspace(w.id)}
            className={`h-11 w-11 rounded-2xl flex items-center justify-center text-sm font-bold transition-all border ${activeWorkspaceId === w.id ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-card)] scale-105 border-transparent" : "bg-white/5 text-[var(--sidebar-foreground)] border-white/10 hover:bg-white/10"}`}
            title={w.name}
          >
            {w.name.slice(0, 2).toUpperCase()}
          </button>
        ))}
        <div className="h-px w-8 bg-white/10 my-1" />
        <div className="flex flex-col gap-2 w-full px-2">
          <Input value={newWsName} onChange={(e) => setNewWsName(e.target.value)} placeholder="New workspace" className="h-7 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/40" />
          {wsError && <div className="text-xs text-red-200 bg-red-950/40 border border-red-800 rounded-lg p-1">{wsError}</div>}
          <Button size="sm" onClick={createWorkspace} className="h-7 text-xs">+ Create</Button>
        </div>
        <div className="mt-auto flex flex-col items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${presence[me?.id] === "online" ? "bg-[var(--success)]" : "bg-white/20"}`} />
          <span className="text-xs text-white/60">{(me?.name ?? "You").slice(0, 8)}</span>
        </div>
      </div>

      {/* channel sidebar */}
      <div className="w-[260px] shrink-0 bg-[var(--sidebar-muted)] text-[var(--sidebar-foreground)] flex flex-col hidden md:flex border-r border-[var(--sidebar-border)]">
        <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--sidebar-border)]">
          <span className="font-semibold text-sm truncate">{workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? "Select workspace"}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowNotifs((v) => !v)}
              className="relative h-7 w-7 rounded-lg bg-white/10 hover:bg-white/15 text-sm border border-white/10"
              title="Notifications"
            >
              🔔
              {(notifData?.unread ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-[10px] font-bold flex items-center justify-center">
                  {notifData!.unread > 9 ? "9+" : notifData!.unread}
                </span>
              )}
            </button>
            <button onClick={() => { setShowInvite((v) => !v); setInviteError(null); setMemberMsg(null); }} className="h-7 w-7 rounded-lg bg-white/10 hover:bg-white/15 text-sm border border-white/10">＋</button>
          </div>
        </div>

        {showNotifs && (
          <div className="border-b border-[var(--sidebar-border)] bg-black/20 max-h-64 overflow-y-auto">
            <div className="px-3 py-2 flex items-center justify-between sticky top-0 bg-[var(--sidebar-muted)]">
              <span className="text-xs font-semibold tracking-widest text-white/50">NOTIFICATIONS</span>
              {(notifData?.unread ?? 0) > 0 && (
                <button onClick={async () => { await api.markAllNotificationsRead(); qc.invalidateQueries({ queryKey: ["notifications"] }); }} className="text-xs text-[var(--accent)] underline">Mark all read</button>
              )}
            </div>
            {(notifData?.items ?? []).length === 0 && <div className="px-3 py-3 text-xs text-white/40">Nothing yet. Mentions, DMs and thread replies land here.</div>}
            {(notifData?.items ?? []).map((n: any) => (
              <button
                key={n.id}
                onClick={async () => {
                  if (!n.read) { await api.markNotificationRead(n.id); qc.invalidateQueries({ queryKey: ["notifications"] }); }
                  if (n.channelId) setActiveChannel(n.channelId);
                }}
                className={`w-full text-left px-3 py-2 border-t border-white/5 hover:bg-white/5 ${n.read ? "opacity-50" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded ${n.type === "mention" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : n.type === "dm" ? "bg-emerald-600 text-white" : "bg-white/15 text-white/80"}`}>{n.type}</span>
                  <span className="text-xs text-white/90 truncate">{n.title}</span>
                  {!n.read && <span className="ml-auto h-2 w-2 rounded-full bg-[var(--accent)] shrink-0" />}
                </div>
                {n.body && <div className="mt-1 text-xs text-white/50 line-clamp-2">{n.body}</div>}
              </button>
            ))}
          </div>
        )}

        {showInvite && (
          <div className="p-3 border-b border-[var(--sidebar-border)] space-y-2 bg-black/10">
            <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doInvite()} placeholder="Add by name or email" className="bg-white/5 border-white/10 text-white placeholder:text-white/40" />
            {inviteError && <div className="text-xs text-red-200 bg-red-950/40 border border-red-800/50 rounded-lg p-2">{inviteError}</div>}
            {memberMsg && <div className={`text-xs rounded-lg p-2 border ${memberMsg.kind === "ok" ? "text-emerald-200 bg-emerald-950/40 border-emerald-800/50" : "text-red-200 bg-red-950/40 border-red-800/50"}`}>{memberMsg.text}</div>}
            <Button size="sm" className="w-full" onClick={doInvite}>Add member</Button>
            <div className="text-xs text-white/30">Exact name or email. Unknown emails get an invite link instead.</div>
          </div>
        )}

        <div className="p-3 space-y-4 flex-1 overflow-y-auto">
          <div>
            <div className="text-xs font-semibold tracking-widest text-white/40 mb-2">SEARCH</div>
            <div className="flex gap-1">
              <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} placeholder="Search messages…" className="flex-1 h-8 rounded-lg bg-white/5 border border-white/10 px-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-[var(--primary)]" />
              <Button size="sm" variant="secondary" onClick={doSearch} className="h-8">Go</Button>
            </div>
            {searchRes.length > 0 && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {searchRes.map((r: any) => (
                  <div key={r.id} className="rounded-lg bg-white/5 border border-white/10 p-2 text-xs">
                    <div className="text-[var(--accent)]">#{r.channel?.name}</div>
                    <div className="text-white/80 truncate">{r.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold tracking-widest text-white/40 mb-2">CHANNELS</div>
            <div className="space-y-1">
              {channels.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveChannel(c.id)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm flex items-center gap-2 border ${activeChannelId === c.id ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent shadow-[var(--shadow-soft)]" : "text-white/60 border-transparent hover:bg-white/5 hover:text-white"}`}
                >
                  <span className="text-xs opacity-70">#</span>
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto text-xs opacity-50">{c.type}</span>
                </button>
              ))}
              {channels.length === 0 && <div className="text-xs text-white/40">No channels yet — try “general”.</div>}
            </div>
            <div className="mt-3 space-y-1">
              <div className="flex gap-1">
                <input value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createChannel()} placeholder="new-channel (a-z, 0-9, -)" className="flex-1 h-7 rounded-lg bg-white/5 border border-white/10 px-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-[var(--primary)]" />
                <Button size="sm" onClick={createChannel} className="h-7 px-3">+</Button>
              </div>
              {chError && <div className="text-xs text-red-200 bg-red-950/30 border border-red-800/50 rounded-lg p-2">{chError}</div>}
              <div className="text-xs text-white/30">Spaces → “-”, auto-lowercased.</div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold tracking-widest text-white/40 mb-2">DIRECT</div>
            <div className="space-y-1 opacity-60 text-xs text-white/40">DMs: use “dm” channel type via API — UI coming next.</div>
          </div>
        </div>

        <div className="p-3 border-t border-[var(--sidebar-border)] flex items-center gap-2 bg-black/10">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)] text-xs font-bold">{(me?.name ?? "U").slice(0, 2).toUpperCase()}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate text-white">{me?.name ?? me?.email ?? "User"}</div>
            <div className="text-xs text-emerald-300 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Online</div>
          </div>
          <Button variant="ghost" size="sm" onClick={async () => { await api.authSignOut(); location.reload(); }} className="text-white/70 hover:text-white hover:bg-white/10">Sign out</Button>
        </div>
      </div>

      {/* main */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--background)]">
        {activeChannelId ? <ChannelView channelId={activeChannelId} /> : <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">Select a channel — or create one above.</div>}
      </div>
    </div>
  );
}

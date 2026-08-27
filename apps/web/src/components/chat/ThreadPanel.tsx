"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { useUiStore } from "@/store/ui";
import { MessageItem } from "./MessageItem";

/**
 * Right-hand thread panel (mobile has a dedicated thread screen). Reuses the
 * channel message renderer for the parent + its replies, with a composer that
 * posts replies against the same parentId.
 */
export function ThreadPanel() {
  const threadId = useUiStore((s) => s.threadId);
  const closeThread = useUiStore((s) => s.closeThread);
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null) });
  const meId = (me as any)?.id as string | undefined;

  const parentQuery = useQuery({
    queryKey: ["message", threadId],
    queryFn: () => api.message(threadId as string),
    enabled: !!threadId,
  });
  const repliesQuery = useQuery({
    queryKey: ["replies", threadId],
    queryFn: () => api.replies(threadId as string),
    enabled: !!threadId,
  });

  const parent = parentQuery.data as any;
  const replies = (repliesQuery.data as any[]) ?? [];
  const channelId = parent?.channelId as string | undefined;

  // live: append replies when a matching message:new arrives
  useEffect(() => {
    if (!threadId) return;
    const s = connectSocket();
    const onNew = (msg: any) => {
      if (msg?.parentId === threadId) qc.invalidateQueries({ queryKey: ["replies", threadId] });
    };
    s.on("message:new", onNew);
    s.on("message", onNew);
    return () => {
      s.off("message:new", onNew);
      s.off("message", onNew);
    };
  }, [threadId, qc]);

  if (!threadId) return null;

  async function send() {
    const content = draft.trim();
    if (!content || !channelId) return;
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDraft("");
    try {
      await api.sendMessage(channelId, { content, parentId: threadId, nonce });
      await qc.invalidateQueries({ queryKey: ["replies", threadId] });
      if (channelId) await qc.invalidateQueries({ queryKey: ["messages", channelId] });
    } catch {
      // surface nothing for now; the channel will resync on next open
    }
  }

  return (
    <aside className="w-[380px] shrink-0 border-l border-[var(--border)] bg-[var(--background)] flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 h-14 border-b border-[var(--border)] shrink-0">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-[var(--foreground)]">Thread</span>
          <span className="text-xs text-[var(--muted-foreground)]">{replies.length} {replies.length === 1 ? "reply" : "replies"}</span>
        </div>
        <button
          onClick={closeThread}
          title="Close thread"
          className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {parentQuery.isLoading ? (
          <div className="p-4 text-sm text-[var(--muted-foreground)]">Loading thread…</div>
        ) : parentQuery.isError || !parent ? (
          <div className="p-4 text-sm text-[var(--muted-foreground)]">Thread not found.</div>
        ) : (
          <>
            <div className="border-b border-[var(--border)]">
              <MessageItem msg={parent} isOwn={meId === parent.senderId} meId={meId} />
            </div>
            <div className="py-1">
              {replies.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-[var(--muted-foreground)]">
                  No replies yet — start the conversation below.
                </div>
              ) : (
                replies.map((r: any) => (
                  <MessageItem key={r.id} msg={r} isOwn={meId === r.senderId} meId={meId} />
                ))
              )}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Reply in thread…"
            className="flex-1 resize-none rounded-[var(--radius-sm)] border border-[var(--input-border)] bg-[var(--input)] text-[var(--foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
          <button
            onClick={() => void send()}
            disabled={!draft.trim()}
            className="h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  );
}

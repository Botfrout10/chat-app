"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getSocket, connectSocket } from "@/lib/socket";
import { MessageItem } from "./MessageItem";
import { Button } from "@/components/ui/button";

type Props = { channelId: string; workspaceId?: string };

export function ChannelView({ channelId }: Props) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachmentKeys, setAttachmentKeys] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["messages", channelId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const q = pageParam ? `?before=${pageParam}&limit=30` : `?limit=30`;
      const res: any = await api.messages(channelId, q);
      return res as { messages: any[]; nextCursor: string | null; hasMore: boolean };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const allMessages = (data?.pages.flatMap((p) => p.messages) ?? []).slice().reverse();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me().catch(() => null) });

  useEffect(() => {
    const s = connectSocket();
    const join = () => s.emit("join:channel", channelId);
    if (s.connected) join();
    s.on("connect", join);
    // insert newest-first (pages are DESC); dedupe so socket echo of our own
    // optimistic append doesn't duplicate the row
    const upsert = (old: any, msg: any) => {
      if (!old) return old;
      const pages = old.pages.map((p: any) => ({ ...p, messages: p.messages.filter((m: any) => m.id !== msg.id) }));
      pages[0] = { ...pages[0], messages: [msg, ...pages[0].messages] };
      return { ...old, pages };
    };
    const onNew = (msg: any) => {
      qc.setQueryData(["messages", channelId], (old: any) => upsert(old, msg));
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 50);
    };
    const onUpdated = (msg: any) => {
      qc.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;
        const pages = old.pages.map((p: any) => ({ ...p, messages: p.messages.map((m: any) => (m.id === msg.id ? { ...m, ...msg } : m)) }));
        return { ...old, pages };
      });
    };
    const onDeleted = ({ messageId }: any) => {
      qc.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;
        const pages = old.pages.map((p: any) => ({ ...p, messages: p.messages.map((m: any) => (m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), content: "[deleted]" } : m)) }));
        return { ...old, pages };
      });
    };
    s.on("message:new", onNew);
    s.on("message", onNew);
    s.on("message:updated", onUpdated);
    s.on("message:deleted", onDeleted);
    s.on("reaction:update", () => qc.invalidateQueries({ queryKey: ["messages", channelId] }));
    return () => {
      s.emit("leave:channel", channelId);
      s.off("connect", join);
      s.off("message:new", onNew);
      s.off("message", onNew);
      s.off("message:updated", onUpdated);
      s.off("message:deleted", onDeleted);
    };
  }, [channelId, qc]);

  const [typing, setTyping] = useState<string[]>([]);
  useEffect(() => {
    const s = getSocket();
    const handler = (p: any) => {
      if (p.channelId !== channelId) return;
      setTyping((prev) => {
        if (p.isTyping) return prev.includes(p.userId) ? prev : [...prev, p.userId];
        return prev.filter((id) => id !== p.userId);
      });
      if (p.isTyping) setTimeout(() => setTyping((prev) => prev.filter((id) => id !== p.userId)), 4000);
    };
    s.on("typing:update", handler);
    return () => { s.off("typing:update", handler); };
  }, [channelId]);

  useEffect(() => {
    if (listRef.current && allMessages.length) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [allMessages.length]);

  let typingTimeout: any;
  function handleTyping(v: string) {
    setInput(v);
    const s = getSocket();
    if (typingTimeout) clearTimeout(typingTimeout);
    s.emit("typing:start", { channelId });
    typingTimeout = setTimeout(() => s.emit("typing:stop", { channelId }), 1500);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const presigned: any = await api.presign({ filename: file.name, mime: file.type || "application/octet-stream", size: file.size });
      await fetch(presigned.url, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      setAttachmentKeys((k) => [...k, presigned.key]);
    } catch (err) {
      alert("Upload failed: " + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send() {
    if (!input.trim() && attachmentKeys.length === 0) return;
    const content = input.trim() || (attachmentKeys.length ? "📎 Attachment" : "");
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const parentAtSend = replyTo;
    setInput("");
    setReplyTo(null);
    const keys = [...attachmentKeys];
    setAttachmentKeys([]);
    try {
      const saved: any = await api.sendMessage(channelId, { content, parentId: parentAtSend, attachmentKeys: keys, nonce });
      // show instantly — don't wait for the socket echo
      qc.setQueryData(["messages", channelId], (old: any) => {
        if (!old || !saved?.id) return old;
        const pages = old.pages.map((p: any) => ({ ...p, messages: p.messages.filter((m: any) => m.id !== saved.id) }));
        pages[0] = { ...pages[0], messages: [saved, ...pages[0].messages] };
        return { ...old, pages };
      });
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 50);
      const s = getSocket();
      s.emit("typing:stop", { channelId });
    } catch (e) {
      alert((e as Error).message);
    }
  }

  if (isLoading) return <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">Loading messages…</div>;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[var(--background)]">
      <div className="h-14 border-b border-[var(--border)] flex items-center px-4 justify-between shrink-0 bg-[var(--card)]">
        <div className="flex items-center gap-2">
          <span className="h-6 w-6 rounded-lg bg-[var(--muted)] border border-[var(--border)] flex items-center justify-center text-xs font-bold text-[var(--muted-foreground)]">#</span>
          <span className="text-sm font-semibold text-[var(--foreground)]">{channelId.slice(0, 8)}</span>
          <span className="text-xs text-[var(--muted-foreground)]">{allMessages.length} messages</span>
        </div>
        <div className="flex items-center gap-2">
          {hasNextPage && (
            <Button variant="ghost" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "Loading…" : "Load older"}
            </Button>
          )}
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto py-2 bg-[var(--background)]">
        {allMessages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
            <div className="h-12 w-12 rounded-2xl bg-[var(--accent-100)] dark:bg-[var(--sidebar-muted)] border border-[var(--border)] flex items-center justify-center text-xl">💬</div>
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">No messages yet</p>
            <p className="text-xs text-[var(--muted-foreground)]">Be the first to break the ice</p>
          </div>
        ) : (
          allMessages.map((m: any) => (
            <MessageItem key={m.id} msg={m} onReply={setReplyTo} isOwn={me?.id === m.senderId} />
          ))
        )}
        {typing.length > 0 && <div className="px-4 py-1 text-xs text-[var(--muted-foreground)] italic bg-[var(--accent-50)] dark:bg-white/5 border-y border-[var(--border)]">{typing.length === 1 ? "Someone is typing…" : `${typing.length} people are typing…`}</div>}
      </div>

      <div className="border-t border-[var(--border)] p-3 bg-[var(--card)]">
        {replyTo && <div className="mb-2 text-xs text-[var(--primary)] bg-[var(--accent-50)] dark:bg-[var(--sidebar-muted)] border border-[var(--border)] rounded-lg px-3 py-2">↩ Replying to {replyTo.slice(0, 8)} <button onClick={() => setReplyTo(null)} className="ml-2 underline">cancel</button></div>}
        {attachmentKeys.length > 0 && <div className="mb-2 text-xs text-[var(--muted-foreground)] bg-[var(--muted)] border border-[var(--border)] rounded-lg px-3 py-2">{attachmentKeys.length} file(s) ready to send <button onClick={() => setAttachmentKeys([])} className="underline ml-2">clear</button></div>}
        <div className="flex items-end gap-2 rounded-[var(--radius)] border border-[var(--input-border)] bg-[var(--muted)] p-2">
          <button onClick={() => fileRef.current?.click()} className="h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--card)] border border-[var(--border)] flex items-center justify-center text-sm hover:bg-[var(--background)] text-[var(--foreground)]">
            📎
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
          <textarea
            value={input}
            onChange={(e) => handleTyping(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message… (Enter to send, Shift+Enter for new line)"
            rows={1}
            className="flex-1 bg-transparent outline-none text-sm resize-none max-h-24 py-2 placeholder:text-[var(--muted-foreground)]/60 text-[var(--foreground)]"
          />
          <Button onClick={send} disabled={uploading || (!input.trim() && attachmentKeys.length === 0)} className="rounded-[var(--radius-sm)]">
            {uploading ? "…" : "Send"}
          </Button>
        </div>
        <div className="mt-1 text-xs text-[var(--muted-foreground)] hidden sm:block">Markdown • @mention • Enter to send</div>
      </div>
    </div>
  );
}

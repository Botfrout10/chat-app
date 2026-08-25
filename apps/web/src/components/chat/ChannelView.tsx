"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getSocket, connectSocket } from "@/lib/socket";
import { MessageItem } from "./MessageItem";
import { Button } from "@/components/ui/button";
import { AtSign, BrainCircuit, CornerDownLeft, FileText, Hash, Paperclip, Sparkles, X } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";

type Props = { channelId: string; workspaceId?: string; channel?: any };

/** Keeps a ref in sync with "is the conversation pinned to bottom" (for read receipts). */
function AtBottomSync({ isAtBottomRef }: { isAtBottomRef: React.MutableRefObject<boolean> }) {
  const { isAtBottom } = useStickToBottomContext();
  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom, isAtBottomRef]);
  return null;
}

export function ChannelView({ channelId, workspaceId, channel }: Props) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<{ key: string; filename: string; mime: string; size: number; url: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

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
  const meId: string | null = (me as any)?.id ?? null;
  const meName: string = (me as any)?.name ?? "";

  // members of this channel (read receipts)
  const { data: channelMembers } = useQuery({
    queryKey: ["channelMembers", channelId],
    queryFn: () => api.channelMembers(channelId).catch(() => []),
    enabled: !!channelId,
    refetchInterval: 20_000,
  });

  // connected models: streaming state, typing indicator, mention candidates
  const { data: llmConnections } = useQuery({
    queryKey: ["llm-connections"],
    queryFn: () => api.llmConnections().catch(() => []),
    enabled: !!workspaceId,
  });
  const connLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of (llmConnections as any[]) ?? []) map.set(c.id, c.label);
    return map;
  }, [llmConnections]);
  const [stream, setStream] = useState<{ connectionId: string; text: string; thinking: string } | null>(null);
  const [llmTyping, setLlmTyping] = useState<string | null>(null); // connectionId

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
      // final LLM reply arrived — drop the streaming placeholder
      if (msg?.llmConnectionId) {
        setStream((cur) => (cur?.connectionId === msg.llmConnectionId ? null : cur));
        setLlmTyping((cur) => (cur === msg.llmConnectionId ? null : cur));
      }
      // auto-mark read when in view and at bottom (StickToBottom pins us there)
      if (meId && isAtBottomRef.current && msg?.id) {
        api.markRead(channelId, msg.id).catch(() => {});
      }
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
  }, [channelId, qc, meId]);

  const [typing, setTyping] = useState<string[]>([]);
  useEffect(() => {
    const s = getSocket();
    // LLM streaming: typing → deltas → final message (handled in onNew above)
    const onLlmTyping = (p: any) => {
      if (p.channelId !== channelId) return;
      setLlmTyping(p.isTyping ? p.connectionId : null);
      if (!p.isTyping) return;
      setStream({ connectionId: p.connectionId, text: "", thinking: "" });
    };
    const onLlmThinking = (p: any) => {
      if (p.channelId !== channelId || !p.delta) return;
      setStream((cur) =>
        cur && cur.connectionId === p.connectionId ? { ...cur, thinking: cur.thinking + p.delta } : cur,
      );
    };
    const onLlmDelta = (p: any) => {
      if (p.channelId !== channelId || !p.delta) return;
      setStream((cur) =>
        cur && cur.connectionId === p.connectionId ? { ...cur, text: cur.text + p.delta } : cur,
      );
    };
    const onLlmError = (p: any) => {
      if (p.channelId !== channelId) return;
      setLlmTyping(null);
      setStream((cur) => (cur?.connectionId === p.connectionId ? null : cur));
    };
    s.on("llm:typing", onLlmTyping);
    s.on("llm:thinking", onLlmThinking);
    s.on("llm:delta", onLlmDelta);
    s.on("llm:error", onLlmError);
    return () => {
      s.off("llm:typing", onLlmTyping);
      s.off("llm:thinking", onLlmThinking);
      s.off("llm:delta", onLlmDelta);
      s.off("llm:error", onLlmError);
    };
  }, [channelId]);

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

  const isAtBottomRef = useRef(true);
  const lastMarkedRef = useRef<string | null>(null);
  const markReadAtBottom = () => {
    const latest = allMessages.at(-1)?.id;
    if (!latest || latest === lastMarkedRef.current || !meId || !isAtBottomRef.current) return;
    lastMarkedRef.current = latest;
    api.markRead(channelId, latest).catch(() => {});
  };

  useEffect(() => {
    markReadAtBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMessages.length, meId, channelId]);

  // read receipts: keep channelMembers fresh
  useEffect(() => {
    const s = getSocket();
    const h = (evt: any) => {
      if (evt.channelId !== channelId) return;
      qc.setQueryData(["channelMembers", channelId], (prev: any) => {
        if (!prev) return prev;
        return (prev as any[]).map((m: any) => (m.id === evt.userId ? { ...m, lastReadMessageId: evt.lastReadMessageId } : m));
      });
    };
    s.on("read:receipt", h);
    return () => { s.off("read:receipt", h); };
  }, [channelId, qc]);

  let typingTimeout: any;
  function handleTyping(v: string) {
    setInput(v);
    const s = getSocket();
    if (typingTimeout) clearTimeout(typingTimeout);
    s.emit("typing:start", { channelId });
    typingTimeout = setTimeout(() => s.emit("typing:stop", { channelId }), 1500);
  }

  // members for mention autocomplete + highlight
  const { data: members } = useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => api.members(workspaceId!).catch(() => []),
    enabled: !!workspaceId,
  });
  const memberTokens = useMemo(() => {
    const s = new Set<string>();
    for (const m of (members as any) ?? []) {
      if (m?.name) s.add(String(m.name).toLowerCase());
      const local = String(m?.email ?? "").split("@")[0]?.toLowerCase();
      if (local) s.add(local);
    }
    return s;
  }, [members]);

  // @mention autocomplete state — includes connected AI models
  const modelCandidates = useMemo(
    () => (((llmConnections as any[]) ?? []).map((c: any) => ({ id: c.id, name: c.label, email: `@${c.mentionName}`, isModel: true, mentionName: c.mentionName }))),
    [llmConnections],
  );
  const [ac, setAc] = useState<{ open: boolean; q: string }>({ open: false, q: "" });
  const acMatches = useMemo(() => {
    if (!ac.open) return [];
    const q = ac.q.toLowerCase();
    return [...((members as any) ?? []), ...modelCandidates].filter((m: any) => {
      const n = String(m.name ?? "").toLowerCase();
      const e = String(m.email ?? "").toLowerCase();
      return n.startsWith(q) || e.startsWith(q);
    }).slice(0, 6);
  }, [ac, members, modelCandidates]);

  const AC_RE = /@([\p{L}\p{N}_.-]*)$/u;
  function handleInput(v: string) {
    handleTyping(v);
    const m = AC_RE.exec(v);
    if (m && workspaceId) setAc({ open: true, q: m[1] });
    else setAc({ open: false, q: "" });
  }

  function pickMention(m: any) {
    setInput((prev) => prev.replace(/@([\p{L}\p{N}_.-]*)$/u, `@${m.isModel ? m.mentionName : m.name} `));
    setAc({ open: false, q: "" });
  }

  async function uploadFile(file: File): Promise<{ key: string; filename: string; mime: string; size: number }> {
    const presigned: any = await api.presign({ filename: file.name, mime: file.type || "application/octet-stream", size: file.size });
    await fetch(presigned.url, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
    return { key: presigned.key, filename: presigned.filename, mime: presigned.mime, size: presigned.size };
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const att = await uploadFile(file);
      setAttachments((k) => [...k, { ...att, url: "" }]);
    } catch (err) {
      alert("Upload failed: " + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send(textOverride?: string) {
    const text = textOverride ?? input;
    if (!text.trim() && attachments.length === 0) return;
    const content = text.trim() || "(attachment)";
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const parentAtSend = replyTo;
    setInput("");
    setReplyTo(null);
    setAc({ open: false, q: "" });
    const atts = attachments.map(({ key, filename, mime, size }) => ({ key, filename, mime, size }));
    setAttachments([]);
    try {
      const saved: any = await api.sendMessage(channelId, { content, parentId: parentAtSend, attachments: atts, nonce });
      // show instantly — don't wait for the socket echo
      qc.setQueryData(["messages", channelId], (old: any) => {
        if (!old || !saved?.id) return old;
        const pages = old.pages.map((p: any) => ({ ...p, messages: p.messages.filter((m: any) => m.id !== saved.id) }));
        pages[0] = { ...pages[0], messages: [saved, ...pages[0].messages] };
        return { ...old, pages };
      });
      const s = getSocket();
      s.emit("typing:stop", { channelId });
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handlePromptSubmit({ text }: { text: string }) {
    await send(text);
  }

  // NOTE: must stay above any early return — all hooks run unconditionally
  const readByMap = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of (channelMembers as any[]) ?? []) {
      if (!r.lastReadMessageId || r.id === meId) continue;
      const arr = m.get(r.lastReadMessageId);
      if (arr) arr.push(r);
      else m.set(r.lastReadMessageId, [r]);
    }
    return m;
  }, [channelMembers, meId]);

  if (isLoading) return <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">Loading messages…</div>;

  const isDm = channel?.type === "dm";
  const title = isDm ? `@${channel?.dmPeer?.name ?? "direct message"}` : `#${channel?.name ?? channelId.slice(0, 8)}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)]">
      <div className="h-14 border-b border-[var(--border)] flex items-center px-4 justify-between shrink-0 bg-[var(--card)]">
        <div className="flex items-center gap-2">
          <span className="h-6 w-6 rounded-lg bg-[var(--muted)] border border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)]">{isDm ? <AtSign className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />}</span>
          <span className="text-sm font-semibold text-[var(--foreground)]">{title}</span>
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

      <Conversation className="bg-[var(--background)]">
        <AtBottomSync isAtBottomRef={isAtBottomRef} />
        <ConversationContent className="mx-auto w-full max-w-3xl gap-0 px-4 py-2">
          {allMessages.length === 0 ? (
            <ConversationEmptyState
              icon={
                <div className="h-12 w-12 rounded-2xl bg-[var(--accent-100)] dark:bg-[var(--sidebar-muted)] border border-[var(--border)] flex items-center justify-center">
                  <BrainCircuit className="h-6 w-6 text-[var(--primary)]" />
                </div>
              }
              title="No messages yet"
              description="Be the first to break the ice"
            />
          ) : (
            allMessages.map((m: any) => (
              <MessageItem key={m.id} msg={m} onReply={setReplyTo} isOwn={meId === m.senderId} memberTokens={memberTokens} meName={meName} readBy={readByMap.get(m.id) ?? []} />
            ))
          )}

          {/* live LLM stream placeholder */}
          {stream && (
            <Message from="assistant" className="max-w-full gap-1 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
                <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)]"><Sparkles className="h-3 w-3" /></span>
                {connLabel.get(stream.connectionId) ?? "AI"}
                {!stream.text && !stream.thinking && (
                  <Shimmer className="font-normal text-[var(--muted-foreground)]">is thinking…</Shimmer>
                )}
              </div>
              {!!stream.thinking && (
                <Reasoning isStreaming={!stream.text} defaultOpen={!stream.text}>
                  <ReasoningTrigger className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]" />
                  <ReasoningContent className="max-h-64 overflow-y-auto break-words text-xs text-[var(--muted-foreground)]">
                    {stream.thinking}
                  </ReasoningContent>
                </Reasoning>
              )}
              {stream.text && <MessageResponse className="text-sm break-words">{stream.text}</MessageResponse>}
            </Message>
          )}

          {typing.length > 0 && (
            <div className="px-4 py-1 text-xs text-[var(--muted-foreground)] italic bg-[var(--accent-50)] dark:bg-white/5 border-y border-[var(--border)] -mx-4">
              {typing.length === 1 ? "Someone is typing…" : `${typing.length} people are typing…`}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="relative border-t border-[var(--border)] p-3 bg-[var(--card)] shrink-0 mx-auto w-full max-w-3xl">
        {replyTo && (
          <div className="mb-2 text-xs text-[var(--primary)] bg-[var(--accent-50)] dark:bg-[var(--sidebar-muted)] border border-[var(--border)] rounded-lg px-3 py-2 flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> Replying to {replyTo.slice(0, 8)}
            <button onClick={() => setReplyTo(null)} className="ml-2 underline">cancel</button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <span key={a.key} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-1 text-xs text-[var(--foreground)]">
                <FileText className="h-3.5 w-3.5" /> {a.filename}
                <button title="Remove attachment" onClick={() => setAttachments((k) => k.filter((x) => x.key !== a.key))} className="ml-1 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
        )}
        {ac.open && acMatches.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-[var(--border)] bg-popover shadow-[var(--shadow-card)] overflow-hidden z-10">
            <div className="px-3 py-1.5 text-xs font-semibold tracking-widest text-[var(--muted-foreground)] border-b border-[var(--border)]">MEMBERS</div>
            {acMatches.map((m: any) => (
              <button key={m.id} onMouseDown={(e) => { e.preventDefault(); pickMention(m); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--muted)] text-left">
                {m.isModel ? (
                  <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)]"><Sparkles className="h-3 w-3" /></span>
                ) : (
                  <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)] text-[10px] font-bold">{String(m.name).slice(0, 2).toUpperCase()}</span>
                )}
                <span className="text-sm text-[var(--foreground)]">{m.name}</span>
                <span className="text-xs text-[var(--muted-foreground)] ml-auto truncate max-w-[160px]">{m.isModel ? `model · @${m.mentionName}` : m.email}</span>
              </button>
            ))}
          </div>
        )}
        <PromptInput onSubmit={handlePromptSubmit}>
          <PromptInputBody>
            <PromptInputTools>
              <PromptInputButton title="Attach file" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Paperclip className="h-4 w-4" />
              </PromptInputButton>
              <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
            </PromptInputTools>
            <PromptInputTextarea
              value={input}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={(e) => {
                if (ac.open && acMatches.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
                  e.preventDefault();
                  pickMention(acMatches[0]);
                  return;
                }
                if (e.key === "Escape") setAc({ open: false, q: "" });
              }}
              placeholder="Message… (@ to mention, Enter to send, Shift+Enter for new line)"
            />
          </PromptInputBody>
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit
              disabled={uploading || (!input.trim() && attachments.length === 0)}
              title="Send"
            >
              {uploading ? "…" : undefined}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
        <div className="mt-1 text-xs text-[var(--muted-foreground)] hidden sm:block">Markdown • @mention • images preview inline</div>
      </div>
    </div>
  );
}

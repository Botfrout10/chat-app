"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getSocket, connectSocket } from "@/lib/socket";
import { useChatStore } from "@/store/chat";
import { useUiStore } from "@/store/ui";
import { MessageItem } from "./MessageItem";
import { Button } from "@/components/ui/button";
import { AtSign, Bot, BrainCircuit, CornerDownLeft, Hash, Sparkles, AlertTriangle, WifiOff, CheckCircle2, Loader2, Clock, RefreshCw } from "lucide-react";
import type { FileUIPart } from "ai";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { toast } from "sonner";
import { ulid } from "ulid";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Attachments, Attachment, AttachmentPreview, AttachmentRemove } from "@/components/ai-elements/attachments";
import {
  Message,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";

type Props = { channelId: string; workspaceId?: string; channel?: any };

/** stable empty array — keeps MessageItem's memo from invalidating every render */
const EMPTY_READBY: { id: string; name: string; image?: string | null }[] = [];

/** Inline chips for files staged in the PromptInput attachment context. */
function PromptInputAttachmentsDisplay() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <Attachments variant="inline">
      {attachments.files.map((a) => (
        <Attachment data={a} key={a.id} onRemove={() => attachments.remove(a.id)}>
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  );
}

/** Preset-composed composer: attachments header, textarea, footer w/ attach menu + submit. */
function ChatComposer({
  value, onValueChange, onKeyDown, onSubmit, replyTo, onCancelReply, busy,
  disabled, placeholder, queuedCount,
}: {
  value: string;
  onValueChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (m: { text: string; files: FileUIPart[] }) => void | Promise<void>;
  replyTo: string | null;
  onCancelReply: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  queuedCount?: number;
}) {
  // 25 MB cap mirrors presignSchema max; must stay in sync with apps/api/src/modules/attachments.ts:41 + packages/shared/src/schemas.ts:31
  const MAX_FILE_SIZE = 25 * 1024 * 1024;
  const MAX_FILES = 10;
  const handleAttachmentError = (err: { code: string; message: string }) => {
    if (err.code === "max_file_size") toast.error(`File too large — max ${MAX_FILE_SIZE / (1024 * 1024)} MB`);
    else if (err.code === "max_files") toast.error(`Too many files — max ${MAX_FILES} per message`);
    else if (err.code === "accept") toast.error(err.message);
    else toast.error(err.message);
  };

  return (
    <PromptInput onSubmit={onSubmit} multiple globalDrop maxFiles={MAX_FILES} maxFileSize={MAX_FILE_SIZE} onError={handleAttachmentError}>
      {replyTo && (
        <PromptInputHeader>
          <div className="flex w-full items-center gap-1 text-xs text-[var(--primary)] bg-[var(--accent-50)] dark:bg-[var(--sidebar-muted)] border border-[var(--border)] rounded-lg px-3 py-2">
            <CornerDownLeft className="h-3 w-3 shrink-0" /> Replying to {replyTo.slice(0, 8)}
            <button onClick={onCancelReply} className="ml-auto underline">cancel</button>
          </div>
        </PromptInputHeader>
      )}
      <PromptInputHeader>
        <PromptInputAttachmentsDisplay />
      </PromptInputHeader>
      <PromptInputBody>
        <PromptInputTextarea
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? "Message… (@ to mention, Enter to send, Shift+Enter for new line)"}
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger title="Attach files" disabled={disabled} />
            <PromptInputActionMenuContent side="top" align="start">
              <PromptInputActionAddAttachments />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          {queuedCount != null && queuedCount > 0 && (
            <span className="ml-2 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><Clock className="h-3 w-3" />{queuedCount} queued</span>
          )}
        </PromptInputTools>
        <PromptInputSubmit disabled={busy || disabled} title={disabled ? "Model offline — message will be queued" : "Send"} />
      </PromptInputFooter>
    </PromptInput>
  );
}

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
  const openThread = useUiStore((s) => s.openThread);
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
  // live streams survive switching channels mid-generation
  const stream = useChatStore((s) => s.llmStreams[channelId] ?? null);
  const agentStream = useChatStore((s) => s.agentStreams[channelId] ?? null);
  const highlightedMessageId = useChatStore((s) => s.highlightedMessageId);
  const setHighlightedMessage = useChatStore((s) => s.setHighlightedMessage);
  const { data: workspaceAgents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => (api as any).agents().catch(() => []),
    enabled: !!workspaceId,
  });
  const agentsInWorkspace = useMemo(() => ((workspaceAgents as any[]) ?? []).filter((a: any) => a.workspaceId === workspaceId), [workspaceAgents, workspaceId]);

  // palette jump-to-message: scroll + highlight, fetch window around if not in current pages
  useEffect(() => {
    if (!highlightedMessageId) return;
    const exists = allMessages.some((m: any) => m.id === highlightedMessageId);
    if (exists) {
      requestAnimationFrame(() => {
        document.getElementById(`msg-${highlightedMessageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const t = setTimeout(() => setHighlightedMessage(null), 2500);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    (async () => {
      try {
        const fetched: any = await api.message(highlightedMessageId).catch(() => null);
        if (!fetched || fetched.channelId !== channelId || cancelled) return;
        const [beforeRes, afterRes]: any = await Promise.all([
          api.messages(channelId, `?before=${highlightedMessageId}&limit=15`).catch(() => ({ messages: [] })),
          api.messages(channelId, `?after=${highlightedMessageId}&limit=15`).catch(() => ({ messages: [] })),
        ]);
        if (cancelled) return;
        const around: any[] = [...(beforeRes.messages ?? []), fetched, ...(afterRes.messages ?? [])];
        around.sort((a: any, b: any) => (a.id < b.id ? 1 : -1));
        qc.setQueryData(["messages", channelId], (old: any) => {
          if (!old) return { pages: [{ messages: around, nextCursor: null, hasMore: false }], pageParams: [undefined] };
          const existingIds = new Set(allMessages.map((m: any) => m.id));
          const toAdd = around.filter((m: any) => !existingIds.has(m.id));
          if (!toAdd.length) return old;
          const pages = old.pages.map((p: any) => ({ ...p }));
          const merged = [...pages[0].messages, ...toAdd].sort((a: any, b: any) => (a.id < b.id ? 1 : -1));
          pages[0] = { ...pages[0], messages: merged };
          return { ...old, pages };
        });
        setTimeout(() => {
          if (!cancelled) document.getElementById(`msg-${highlightedMessageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
        setTimeout(() => { if (!cancelled) setHighlightedMessage(null); }, 3000);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [highlightedMessageId, allMessages, channelId, qc, setHighlightedMessage]);

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
      // final LLM/agent reply arrived — drop the streaming placeholder
      if (msg?.llmConnectionId) {
        useChatStore.getState().clearLlmStream(channelId);
      }
      if (msg?.agentId) {
        useChatStore.getState().clearAgentStream(channelId);
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
    for (const c of (llmConnections as any[]) ?? []) {
      if (c?.mentionName) s.add(String(c.mentionName).toLowerCase());
      if (c?.label) s.add(String(c.label).toLowerCase());
    }
    for (const a of (workspaceAgents as any[]) ?? []) {
      const slug = String(a.name ?? "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
      if (slug) s.add(slug);
      if (a.name) s.add(String(a.name).toLowerCase());
    }
    return s;
  }, [members, llmConnections, workspaceAgents]);

  // @mention autocomplete state — includes connected AI models and agents
  const modelCandidates = useMemo(
    () => (((llmConnections as any[]) ?? []).map((c: any) => ({ id: c.id, name: c.label, email: `@${c.mentionName}`, isModel: true, mentionName: c.mentionName }))),
    [llmConnections],
  );
  const agentCandidates = useMemo(() => {
    const slugify = (name: string) => String(name ?? "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]+/g, "-").replace(/--+/g, "-").replace(/^-|-$/g, "");
    return (((workspaceAgents as any[]) ?? []).map((a: any) => ({ id: a.id, name: a.name, email: `@${slugify(a.name)}`, isAgent: true, mentionName: slugify(a.name) })));
  }, [workspaceAgents]);
  const [ac, setAc] = useState<{ open: boolean; q: string }>({ open: false, q: "" });
  const acMatches = useMemo(() => {
    if (!ac.open) return [];
    const q = ac.q.toLowerCase();
    return [...((members as any) ?? []), ...modelCandidates, ...agentCandidates].filter((m: any) => {
      const n = String(m.name ?? "").toLowerCase();
      const e = String(m.email ?? "").toLowerCase();
      return n.startsWith(q) || e.startsWith(q);
    }).slice(0, 6);
  }, [ac, members, modelCandidates, agentCandidates]);

  const AC_RE = /@([\p{L}\p{N}_.-]*)$/u;
  function handleInput(v: string) {
    handleTyping(v);
    const m = AC_RE.exec(v);
    if (m && workspaceId) setAc({ open: true, q: m[1] });
    else setAc({ open: false, q: "" });
  }

  function pickMention(m: any) {
    const token = m.isModel || m.isAgent ? m.mentionName : m.name;
    setInput((prev) => prev.replace(/@([\p{L}\p{N}_.-]*)$/u, `@${token} `));
    setAc({ open: false, q: "" });
  }

  /** Upload a staged attachment part (data URL) via presigned PUT. */
  async function uploadAttachmentPart(part: FileUIPart) {
    const blob = await (await fetch(part.url!)).blob();
    if (blob.size > 25 * 1024 * 1024) throw new Error(`File too large — max 25 MB (got ${(blob.size / (1024 * 1024)).toFixed(1)} MB)`);
    const mime = part.mediaType || blob.type || "application/octet-stream";
    const filename = part.filename || "attachment";
    const presigned: any = await api.presign({ filename, mime, size: blob.size });
    const putRes = await fetch(presigned.url, { method: "PUT", body: blob, headers: { "Content-Type": mime } });
    if (!putRes.ok) throw new Error(`Upload failed ${putRes.status} ${putRes.statusText}`);
    return { key: presigned.key as string, filename: presigned.filename as string, mime: presigned.mime as string, size: presigned.size as number };
  }

  async function send(textOverride?: string, atts: { key: string; filename: string; mime: string; size: number }[] = []) {
    const text = textOverride ?? input;
    if (!text.trim() && atts.length === 0) return;
    const content = text.trim() || "(attachment)";
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const parentAtSend = replyTo;
    setInput("");
    setReplyTo(null);
    setAc({ open: false, q: "" });
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
      throw e;
    }
  }

  async function handlePromptSubmit({ text, files }: { text: string; files: FileUIPart[] }) {
    if (!text.trim() && files.length === 0) return;
    setUploading(true);
    try {
      const atts = [];
      for (const f of files) atts.push(await uploadAttachmentPart(f));
      await send(text, atts);
    } catch (e) {
      alert("Upload failed: " + (e as Error).message);
      throw e;
    } finally {
      setUploading(false);
    }
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

  // rough context-window estimate for AI-model chats (~4 chars/token)
  const estContextTokens = useMemo(() => {
    const chars = allMessages.reduce((n: number, m: any) => n + String(m.content ?? "").length, 0);
    return Math.ceil(chars / 4) + allMessages.length * 4;
  }, [allMessages]);

  // robust AI channel detection: backend now sets channel.llmConnectionId, but
  // fall back to matching bot user ids in channel members/dmPeer so the
  // context indicator survives races or stale channel lists
  const botIdToConn = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of (llmConnections as any[]) ?? []) if (c.botUserId) m.set(c.botUserId, c.id);
    return m;
  }, [llmConnections]);
  const llmConnectionIdForChannel = useMemo(() => {
    if ((channel as any)?.llmConnectionId) return (channel as any).llmConnectionId as string;
    const peerId = (channel as any)?.dmPeer?.id as string | undefined;
    if (peerId && botIdToConn.has(peerId)) return botIdToConn.get(peerId)!;
    const members = (channelMembers as any[]) ?? [];
    for (const mem of members) if (botIdToConn.has(mem.id)) return botIdToConn.get(mem.id)!;
    return null;
  }, [channel, channelMembers, botIdToConn]);
  const maxTokens = useMemo(() => {
    const conn = (llmConnections as any[])?.find((c: any) => c.id === llmConnectionIdForChannel);
    const cap: any = conn?.capabilities;
    const fromCap = cap?.context_length ?? cap?.contextLength ?? cap?.maxTokens ?? cap?.n_ctx ?? null;
    const n = typeof fromCap === "number" ? fromCap : Number(fromCap);
    return Number.isFinite(n) && n > 0 ? n : 8192;
  }, [llmConnections, llmConnectionIdForChannel]);
  const modelId = useMemo(() => {
    const conn = (llmConnections as any[])?.find((c: any) => c.id === llmConnectionIdForChannel);
    return (conn?.modelId as string | undefined) ?? undefined;
  }, [llmConnections, llmConnectionIdForChannel]);
  const isAiChannel = !!llmConnectionIdForChannel;
  // Agent chats (ACP) — keep queuing when agent unreachable, unlike AI which keeps in input
  const isAgentChannel = !!(channel as any)?.agentId || !!(channel as any)?.agentRegistrationId || (channel as any)?.type === "agent";
  const isDm = channel?.type === "dm";
  const title = isDm ? `${channel?.dmPeer?.name ?? "direct message"}` : `${channel?.name ?? channelId.slice(0, 8)}`;
  const aiBotId = useMemo(() => {
    if (!isAiChannel) return null;
    const conn = (llmConnections as any[])?.find((c: any) => c.id === llmConnectionIdForChannel);
    return (conn?.botUserId as string | undefined) ?? (channel as any)?.dmPeer?.id ?? null;
  }, [isAiChannel, llmConnections, llmConnectionIdForChannel, channel]);

  // --- AI model live status: fetched once on open, plus socket errors & send-time checks ---
  const [pendingQueue, setPendingQueue] = useState<Array<{ id: string; text: string; files: FileUIPart[] }>>([]);
  const {
    data: llmStatusDetail,
    isLoading: llmStatusInitialLoading,
    isFetching: llmStatusFetching,
    refetch: refetchLlmStatus,
    error: llmStatusErrorRaw,
  } = useQuery({
    queryKey: ["llm-status", llmConnectionIdForChannel],
    queryFn: () => api.llmConnectionStatus(llmConnectionIdForChannel!),
    enabled: !!isAiChannel && !!llmConnectionIdForChannel,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
  const llmStatusLoading = llmStatusInitialLoading || llmStatusFetching;
  const statusConn: any = (llmStatusDetail as any)?.connection ?? null;
  const providerReachable: boolean | null = (llmStatusDetail as any)?.providerReachable ?? null;
  const providerModels: string[] | null = (llmStatusDetail as any)?.providerModels ?? null;
  const fetchFailed = !!llmStatusErrorRaw;
  const llmStatusError = (llmStatusErrorRaw as Error | null)?.message ?? statusConn?.lastError ?? null;
  const modelInProvider = providerModels && modelId ? providerModels.includes(modelId) : null;

  const isModelOffline = !!isAiChannel && !llmStatusLoading && (
    fetchFailed ||
    providerReachable === false ||
    statusConn?.status === "error" ||
    (providerModels !== null && modelId != null && modelInProvider === false)
  );
  const isModelOnline = !!isAiChannel && !llmStatusLoading && !isModelOffline && providerReachable === true;
  const isModelChecking = !!isAiChannel && llmStatusLoading;

  // "Model online" fades after 3s
  const [showOnlineBanner, setShowOnlineBanner] = useState(false);
  useEffect(() => {
    if (!isModelOnline) {
      setShowOnlineBanner(false);
      return;
    }
    setShowOnlineBanner(true);
    const t = setTimeout(() => setShowOnlineBanner(false), 3000);
    return () => clearTimeout(t);
  }, [isModelOnline, llmConnectionIdForChannel]);

  function formatLlmError(raw: string): string {
    const s = String(raw ?? "");
    // try extract JSON inside "Provider responded 401: {...}"
    try {
      const jsonStart = s.indexOf("{");
      if (jsonStart !== -1) {
        const parsed = JSON.parse(s.slice(jsonStart));
        const inner = parsed?.error?.message || parsed?.error || parsed?.message;
        if (typeof inner === "string" && inner) {
          if (/missing api key/i.test(inner)) return "Missing API key — add it in AI Models settings";
          if (/invalid api key|auth/i.test(inner)) return `Authentication failed — ${inner.slice(0, 120)}`;
          return inner.slice(0, 200);
        }
      }
    } catch {}
    if (/missing api key/i.test(s)) return "Missing API key — add it in AI Models settings";
    if (s.includes("401") || /auth/i.test(s)) return s.replace(/^Provider responded.*?:\s*/, "").slice(0, 200) || "Authentication failed — check API key";
    return s.slice(0, 200);
  }

  // socket llm:error for this channel/connection → mark offline immediately + toast + keep draft
  useEffect(() => {
    if (!isAiChannel || !llmConnectionIdForChannel) return;
    const s = getSocket();
    const onError = (p: any) => {
      if (p.channelId === channelId || p.connectionId === llmConnectionIdForChannel) {
        const raw = String(p.error ?? "");
        const msg = formatLlmError(raw);
        if (msg) toast.error(msg);
        // patch cache to error so dot turns red without extra fetch
        qc.setQueryData(["llm-status", llmConnectionIdForChannel], (prev: any) => {
          if (!prev) return prev;
          return { ...prev, providerReachable: false, connection: { ...prev.connection, status: "error", lastError: msg || prev.connection?.lastError } };
        });
        qc.setQueryData(["llm-connections"], (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((c: any) => c.id === llmConnectionIdForChannel ? { ...c, status: "error", lastError: msg || c.lastError } : c);
        });
        // keep draft: if last human message was just sent, pull it back into composer
        try {
          const data: any = qc.getQueryData(["messages", channelId]);
          const pages = data?.pages as any[] | undefined;
          if (pages && meId) {
            // find newest message by current user in this channel
            const flat = pages.flatMap((p) => p.messages).slice().reverse();
            const lastHuman = [...flat].reverse().find((m: any) => m.senderId === meId && !m.deletedAt) as any;
            if (lastHuman && lastHuman.content) {
              // remove from cache (pull back)
              qc.setQueryData(["messages", channelId], (old: any) => {
                if (!old) return old;
                return { ...old, pages: old.pages.map((p: any) => ({ ...p, messages: p.messages.filter((m: any) => m.id !== lastHuman.id) })) };
              });
              // restore to input
              setInput(lastHuman.content);
              // try delete on server (fire-and-forget, own message)
              api.deleteMessage(lastHuman.id).catch(() => {});
            }
          }
        } catch {}
        // refresh in background to confirm provider state if needed, but no polling loop
        refetchLlmStatus();
      }
    };
    s.on("llm:error", onError);
    return () => { s.off("llm:error", onError); };
  }, [isAiChannel, llmConnectionIdForChannel, channelId, qc, refetchLlmStatus, meId]);

  // keep sidebar dot fresh when live status diverges from cached connections
  useEffect(() => {
    if (!llmStatusDetail || !isAiChannel || !llmConnectionIdForChannel) return;
    // patch the sidebar's llm-connections cache with live reachable state so the dot
    // updates without waiting for a persisted verify (status endpoint doesn't write DB)
    const liveStatus = providerReachable === false || fetchFailed || (providerModels !== null && modelId != null && modelInProvider === false) ? "error" : providerReachable ? "ok" : statusConn?.status;
    const liveError = fetchFailed ? String((llmStatusErrorRaw as Error).message).slice(0, 240) : statusConn?.lastError ?? null;
    qc.setQueryData(["llm-connections"], (prev: any) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map((c: any) => c.id === llmConnectionIdForChannel ? { ...c, status: liveStatus ?? c.status, lastError: liveError ?? c.lastError } : c);
    });
  }, [llmStatusDetail, isAiChannel, llmConnectionIdForChannel, qc, providerReachable, fetchFailed, llmStatusErrorRaw, providerModels, modelId, modelInProvider, statusConn]);

  // queued-send: when model comes back online, flush pending messages sequentially
  const flushingRef = useRef(false);
  const pendingQueueRef = useRef(pendingQueue);
  useEffect(() => { pendingQueueRef.current = pendingQueue; }, [pendingQueue]);
  const isModelOnlineRef = useRef(isModelOnline);
  useEffect(() => { isModelOnlineRef.current = isModelOnline; }, [isModelOnline]);

  useEffect(() => {
    if (!isModelOnline || pendingQueue.length === 0 || flushingRef.current) return;
    flushingRef.current = true;
    // snapshot at flush start — remaining items on failure are re-queued so none are lost
    const toSend = [...pendingQueue];
    setPendingQueue([]);
    (async () => {
      for (let i = 0; i < toSend.length; i++) {
        const item = toSend[i];
        // re-check liveness before each send — provider may have dropped mid-flush
        if (!isModelOnlineRef.current) {
          // model went offline, re-queue this and all remaining
          setPendingQueue((prev) => [...toSend.slice(i), ...prev]);
          toast.error("Model went offline — remaining messages re-queued.");
          break;
        }
        try {
          const atts: { key: string; filename: string; mime: string; size: number }[] = [];
          for (const f of item.files) atts.push(await uploadAttachmentPart(f));
          await send(item.text, atts);
          // wait for the just-sent message's generation to finish before sending
          // the next queued item — server allows only one generation per connection
          // at a time (generating set), so back-to-back sends would drop replies
          if (i < toSend.length - 1) {
            let waited = 0;
            // give the server a moment to start the stream
            await new Promise((r) => setTimeout(r, 600));
            while (waited < 120_000) {
              const st = useChatStore.getState().llmStreams[channelId];
              const isGenerating = !!st && st.connectionId === llmConnectionIdForChannel;
              const typing = (useChatStore.getState().llmTyping as any)?.[channelId];
              if (!isGenerating && !typing) break;
              await new Promise((r) => setTimeout(r, 400));
              waited += 400;
            }
            // small gap between generations
            await new Promise((r) => setTimeout(r, 300));
          }
        } catch (e: any) {
          // re-queue failed item AND all remaining items after it
          setPendingQueue((prev) => [...toSend.slice(i), ...prev]);
          toast.error(`Queued send failed: ${String(e.message ?? e).slice(0, 160)}`);
          break;
        }
      }
      flushingRef.current = false;
      // one more status check after flushing in case provider died mid-flush
      refetchLlmStatus();
      // if new messages were queued while we were flushing, they landed in
      // pendingQueueRef but the effect was blocked by flushingRef — trigger
      // another flush on next tick
      if (pendingQueueRef.current.length > 0) {
        // force effect to re-evaluate (length already changed while blocked)
        setPendingQueue((q) => [...q]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModelOnline, pendingQueue.length]);

  async function handlePromptSubmitQueued({ text, files }: { text: string; files: FileUIPart[] }) {
    if (!text.trim() && files.length === 0) return;
    // Agent chats: queue when agent offline (keeps queuing mechanism for agents)
    if (isAgentChannel) {
      if (isModelOffline) {
        const id = ulid();
        setPendingQueue((q) => [...q, { id, text: text.trim(), files }]);
        toast.message("Agent offline — message queued", { description: `Will send when agent is reachable.` });
        return;
      }
      if (isModelChecking) {
        const id = ulid();
        setPendingQueue((q) => [...q, { id, text: text.trim(), files }]);
        toast.message("Checking agent… message queued", { description: "Will send as soon as reachability is confirmed." });
        return;
      }
      try {
        const fresh: any = await api.llmConnectionStatus(llmConnectionIdForChannel!);
        qc.setQueryData(["llm-status", llmConnectionIdForChannel], fresh);
        const reachable = fresh?.providerReachable;
        const models = fresh?.providerModels as string[] | null;
        const status = fresh?.connection?.status;
        const modelMissing = models !== null && modelId != null && !models.includes(modelId);
        const freshOffline = reachable === false || status === "error" || modelMissing;
        if (freshOffline) {
          const id = ulid();
          setPendingQueue((q) => [...q, { id, text: text.trim(), files }]);
          toast.message("Agent offline — message queued", { description: `Will send when agent is reachable.` });
          return;
        }
      } catch {
        const id = ulid();
        setPendingQueue((q) => [...q, { id, text: text.trim(), files }]);
        toast.message("Agent offline — message queued", { description: `Will send when agent is reachable.` });
        return;
      }
    }
    // AI chats: keep message in input when AI offline — don't persist, just toast and restore draft
    const restoreDraft = (msg: string) => {
      const reason = statusConn?.lastError ? ` — ${String(statusConn.lastError).slice(0, 120)}` : providerReachable === false ? " — provider unreachable" : "";
      toast.error(`Model offline${reason}`, { description: "Fix the model or try again — your message was kept in the composer." });
      // PromptInput manages its own FileUIPart list; restoring text is enough to keep draft visible.
      // Re-populate input so user doesn't lose draft.
      setInput(text);
    };
    if (isAiChannel && !isAgentChannel && isModelOffline) {
      restoreDraft(text);
      return;
    }
    if (isAiChannel && !isAgentChannel && isModelChecking) {
      toast.message("Checking model… please wait", { description: "Reachability check in progress — try again in a moment. Your draft was kept." });
      setInput(text);
      return;
    }
    if (isAiChannel && !isAgentChannel) {
      try {
        const fresh: any = await api.llmConnectionStatus(llmConnectionIdForChannel!);
        qc.setQueryData(["llm-status", llmConnectionIdForChannel], fresh);
        const reachable = fresh?.providerReachable;
        const models = fresh?.providerModels as string[] | null;
        const status = fresh?.connection?.status;
        const modelMissing = models !== null && modelId != null && !models.includes(modelId);
        const freshOffline = reachable === false || status === "error" || modelMissing;
        if (freshOffline) {
          const msg = String(fresh?.connection?.lastError ?? "").slice(0, 120);
          toast.error(`Model offline${msg ? ` — ${msg}` : ""}`, { description: "Your message was kept in the composer." });
          setInput(text);
          return;
        }
      } catch (e: any) {
        toast.error(`Model not reachable — ${String(e?.message ?? e).slice(0, 120)}`, { description: "Your draft was kept." });
        setInput(text);
        return;
      }
    }
    // direct send — for agents queue on failure, for AI keep in input
    if (isAgentChannel) {
      setUploading(true);
      try {
        const atts: { key: string; filename: string; mime: string; size: number }[] = [];
        for (const f of files) atts.push(await uploadAttachmentPart(f));
        await send(text, atts);
      } catch (e: any) {
        const id = ulid();
        setPendingQueue((q) => [...q, { id, text: text.trim(), files }]);
        toast.message("Send failed — message queued", { description: String(e?.message ?? e).slice(0, 160) });
      } finally {
        setUploading(false);
      }
      return;
    }
    if (isAiChannel) {
      setUploading(true);
      try {
        const atts: { key: string; filename: string; mime: string; size: number }[] = [];
        for (const f of files) atts.push(await uploadAttachmentPart(f));
        await send(text, atts);
      } catch (e: any) {
        toast.error(`Send failed — ${String(e?.message ?? e).slice(0, 160)}`, { description: "Your draft was kept in the composer." });
        setInput(text);
      } finally {
        setUploading(false);
      }
      return;
    }
    return handlePromptSubmit({ text, files });
  }

  function handleForceQueuedSend() {
    if (pendingQueue.length === 0) return;
    if (isModelOffline) {
      toast.error("Model still offline — cannot flush queue yet.");
      refetchLlmStatus();
      return;
    }
    if (flushingRef.current) return;
    // React 18 batches synchronous setState, so the previous
    // setPendingQueue([]) + setPendingQueue(copy) collapsed to just `copy`
    // and the effect (deps: isModelOnline, pendingQueue.length) never fired.
    // Break batching with a microtask so length 0 -> N triggers the flush.
    const copy = [...pendingQueue];
    setPendingQueue([]);
    setTimeout(() => setPendingQueue(copy), 0);
  }

  if (isLoading) return <div className="flex-1 flex items-center justify-center text-sm text-[var(--muted-foreground)]">Loading messages…</div>;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)]">
      <div className="h-14 border-b border-[var(--border)] flex items-center px-4 justify-between shrink-0 bg-[var(--card)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-6 w-6 rounded-lg bg-[var(--muted)] border border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)]">{isDm ? <AtSign className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />}</span>
          <span className="text-sm font-semibold text-[var(--foreground)] truncate">{title}</span>
          <span className="text-xs text-[var(--muted-foreground)] shrink-0">{allMessages.length} messages</span>
        </div>
        <div className="flex items-center gap-2">
          {isAiChannel && (
            <Context
              usedTokens={estContextTokens}
              maxTokens={maxTokens}
              modelId={modelId}
              usage={{
                inputTokens: estContextTokens,
                inputTokenDetails: { noCacheTokens: estContextTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
                outputTokens: 0,
                outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
                totalTokens: estContextTokens,
              }}
            >
              <ContextTrigger />
              <ContextContent align="end">
                <ContextContentHeader />
                <ContextContentBody>
                  <ContextInputUsage />
                  <ContextOutputUsage />
                </ContextContentBody>
                <ContextContentFooter />
              </ContextContent>
            </Context>
          )}
          {hasNextPage && (
            <Button variant="ghost" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "Loading…" : "Load older"}
            </Button>
          )}
        </div>
      </div>

      {/* AI model reachability banner — auto-checked on chat open */}
      {isAiChannel && (isModelChecking || isModelOffline || (isModelOnline && showOnlineBanner)) && (
        <div
          role="status"
          aria-live="polite"
          className={
            isModelChecking
              ? "flex items-center gap-2 px-4 py-2.5 text-xs border-b bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200"
              : isModelOffline
                ? "flex items-center gap-2 px-4 py-2.5 text-xs border-b bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200"
                : "flex items-center gap-2 px-4 py-2.5 text-xs border-b bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200 transition-opacity duration-500"
          }
        >
          {isModelChecking ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span>Checking <span className="font-mono font-semibold">{modelId ?? "model"}</span> reachability…</span>
            </>
          ) : isModelOffline ? (
            <>
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                <span className="font-semibold">Model offline</span>
                {providerReachable === false
                  ? " — provider unreachable"
                  : statusConn?.lastError
                    ? ` — ${String(statusConn.lastError).slice(0, 120)}`
                    : modelInProvider === false
                      ? ` — model "${modelId}" not loaded on provider`
                      : " — not reachable"}
                {pendingQueue.length > 0 && (
                  <span className="ml-1">· {pendingQueue.length} message{pendingQueue.length > 1 ? "s" : ""} queued</span>
                )}
              </span>
              <Button variant="outline" size="sm" onClick={() => refetchLlmStatus()} className="h-7 text-xs shrink-0 bg-white dark:bg-transparent">
                <RefreshCw className={`h-3 w-3 ${llmStatusFetching ? "animate-spin" : ""}`} /> Re-check
              </Button>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-semibold">Model online</span> — <span className="font-mono">{modelId}</span> reachable
              </span>
              <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Reachable" />
            </>
          )}
          {!isModelChecking && llmStatusError && isModelOffline && (
            <span className="hidden" aria-hidden>{llmStatusError}</span>
          )}
        </div>
      )}
      {(isAgentChannel || isAiChannel) && pendingQueue.length > 0 && (
        <div className="mx-3 mt-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
              <Clock className="h-3.5 w-3.5" /> {pendingQueue.length} queued message{pendingQueue.length > 1 ? "s" : ""} — will send when {isAgentChannel ? "agent" : "model"} is back
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setPendingQueue([])} className="h-7 text-xs">
                Clear queue
              </Button>
              <Button variant="outline" size="sm" onClick={handleForceQueuedSend} disabled={isModelOffline} className="h-7 text-xs">
                Send now
              </Button>
            </div>
          </div>
          <ul className="mt-1.5 space-y-1 max-h-20 overflow-y-auto">
            {pendingQueue.map((q) => (
              <li key={q.id} className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-100">
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                <span className="flex-1 truncate">{q.text.slice(0, 80) || "(attachment)"}{q.files.length > 0 ? ` · ${q.files.length} file(s)` : ""}</span>
                <button onClick={() => setPendingQueue((prev) => prev.filter((x) => x.id !== q.id))} className="text-amber-700 dark:text-amber-300 hover:underline shrink-0">
                  remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Conversation className="min-h-0 bg-[var(--background)]">
        <AtBottomSync isAtBottomRef={isAtBottomRef} />
        <ConversationContent className="w-full gap-0 px-4 py-2">
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
            allMessages.map((m: any) => {
              const isOwn = meId === m.senderId;
              let dmReadStatus: "sent" | "read" | null = null;
              let aiReadStatus: "sent" | "read" | null = null;
              if (isOwn && isDm && !isAiChannel) {
                const rb = readByMap.get(m.id);
                dmReadStatus = rb && rb.length > 0 ? "read" : "sent";
              }
              if (isOwn && isAiChannel) {
                const hasBotReply = aiBotId ? allMessages.some((x: any) => x.id > m.id && x.senderId === aiBotId) : false;
                const isStreamingForChannel = !!stream && stream.connectionId === llmConnectionIdForChannel;
                // if streaming is active and this is the last own message, treat as read/processing
                const isLastOwn = allMessages.filter((x: any) => x.senderId === meId).at(-1)?.id === m.id;
                aiReadStatus = hasBotReply || (isStreamingForChannel && isLastOwn) ? "read" : "sent";
              }
              return (
                <MessageItem
                  key={m.id}
                  msg={m}
                  onReply={setReplyTo}
                  onViewThread={openThread}
                  isOwn={isOwn}
                  meId={meId}
                  isAiChannel={isAiChannel}
                  isDm={isDm}
                  dmReadStatus={dmReadStatus}
                  aiReadStatus={aiReadStatus}
                  memberTokens={memberTokens}
                  meName={meName}
                  readBy={readByMap.get(m.id) ?? EMPTY_READBY}
                  highlighted={highlightedMessageId === m.id}
                />
              );
            })
          )}

          {/* live LLM stream placeholder */}
          {stream && (
            <Message from="assistant" className="max-w-full gap-1 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
                <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)]"><Sparkles className="h-3 w-3" /></span>
                {connLabel.get(stream.connectionId) ?? "AI"}
                {!stream.text && !stream.thinking && (
                  <Shimmer className="font-normal text-[var(--muted-foreground)]">Loading model into GPU…</Shimmer>
                )}
              </div>
              {!!stream.thinking && (
                <Reasoning defaultOpen={!stream.text}>
                  <ReasoningTrigger className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]" />
                  <ReasoningContent className="max-h-64 overflow-y-auto break-words text-xs text-[var(--muted-foreground)]">
                    {stream.thinking}
                  </ReasoningContent>
                </Reasoning>
              )}
              {stream.text && <MessageResponse className="text-sm break-words">{stream.text}</MessageResponse>}
            </Message>
          )}

          {/* live agent stream placeholder */}
          {agentStream && (
            <Message from="assistant" className="max-w-full gap-1 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
                <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)]"><Bot className="h-3 w-3" /></span>
                {agentsInWorkspace.find((a: any) => a.id === agentStream.agentId)?.name ?? "Agent"}
                {!agentStream.text && !agentStream.thinking && agentStream.toolCalls.length === 0 && (
                  <Shimmer className="font-normal text-[var(--muted-foreground)]">Agent working…</Shimmer>
                )}
              </div>
              {!!agentStream.thinking && (
                <Reasoning defaultOpen>
                  <ReasoningTrigger className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]" />
                  <ReasoningContent className="max-h-64 overflow-y-auto break-words text-xs text-[var(--muted-foreground)]">
                    {agentStream.thinking}
                  </ReasoningContent>
                </Reasoning>
              )}
              {agentStream.toolCalls.length > 0 && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs">
                  <div className="font-semibold tracking-widest text-[var(--muted-foreground)] text-[11px]">TOOL CALLS</div>
                  <ul className="mt-1 space-y-1 font-mono text-[11px]">
                    {agentStream.toolCalls.map((tc, i) => (
                      <li key={i}>· {tc.tool}{tc.args ? ` ${JSON.stringify(tc.args).slice(0, 80)}` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}
              {agentStream.text && <MessageResponse className="text-sm break-words">{agentStream.text}</MessageResponse>}
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

      <div className="relative border-t border-[var(--border)] p-3 bg-[var(--card)] shrink-0 w-full">
        {ac.open && acMatches.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-[var(--border)] bg-popover shadow-[var(--shadow-card)] overflow-hidden z-10">
            <div className="px-3 py-1.5 text-xs font-semibold tracking-widest text-[var(--muted-foreground)] border-b border-[var(--border)]">MEMBERS</div>
            {acMatches.map((m: any) => (
              <button key={m.id} onMouseDown={(e) => { e.preventDefault(); pickMention(m); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--muted)] text-left">
                {m.isModel ? (
                  <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)]"><Sparkles className="h-3 w-3" /></span>
                ) : m.isAgent ? (
                  <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)]"><Bot className="h-3 w-3" /></span>
                ) : (
                  <span className="h-6 w-6 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)] text-[10px] font-bold">{String(m.name).slice(0, 2).toUpperCase()}</span>
                )}
                <span className="text-sm text-[var(--foreground)]">{m.name}</span>
                <span className="text-xs text-[var(--muted-foreground)] ml-auto truncate max-w-[160px]">{m.isModel ? `model · @${m.mentionName}` : m.isAgent ? `agent · @${m.mentionName}` : m.email}</span>
              </button>
            ))}
          </div>
        )}
        <ChatComposer
          value={input}
          onValueChange={handleInput}
          onKeyDown={(e) => {
            if (ac.open && acMatches.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              pickMention(acMatches[0]);
              return;
            }
            if (e.key === "Escape") setAc({ open: false, q: "" });
          }}
          onSubmit={handlePromptSubmitQueued}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          busy={uploading}
          disabled={false}
          placeholder={
            isAiChannel
              ? isModelChecking
                ? "Checking model status — message will be queued…"
                : isModelOffline
                  ? `Model offline — message will be queued (${pendingQueue.length} queued)…`
                  : undefined
              : undefined
          }
          queuedCount={isAiChannel ? pendingQueue.length : undefined}
        />
        <div className="mt-1 text-xs text-[var(--muted-foreground)] hidden sm:block">
          {isAiChannel && isModelOffline ? (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> Model offline — messages queued until reachable · <button onClick={() => refetchLlmStatus()} className="underline">Re-check now</button></span>
          ) : (
            <>Markdown • @mention • images preview inline</>
          )}
        </div>
      </div>
    </div>
  );
}

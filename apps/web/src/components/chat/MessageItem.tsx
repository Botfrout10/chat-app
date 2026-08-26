"use client";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { RichText, AttachmentPreview } from "./RichText";
import { BrainCircuit, CornerUpLeft, Pencil, ThumbsUp, Heart, Laugh, Trash2 } from "lucide-react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";

type Msg = {
  id: string;
  content: string;
  reasoning?: string | null;
  llmConnectionId?: string | null;
  senderId: string;
  sender?: { name: string; image?: string | null };
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  parentId?: string | null;
  reactions?: { emoji: string; userId: string }[];
  attachments?: { key: string; filename: string; mime?: string; size?: number }[];
};

export function MessageItem({ msg, onReply, isOwn, meId, memberTokens, meName, readBy }: { msg: Msg; onReply?: (id: string) => void; isOwn?: boolean; meId?: string | null; memberTokens?: Set<string>; meName?: string; readBy?: { id: string; name: string; image?: string | null }[] }) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(msg.content);
  const [showActions, setShowActions] = useState(false);

  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const groupedReactions = useMemo(() => {
    const map = new Map<string, { count: number; byMe: boolean }>();
    for (const r of msg.reactions ?? []) {
      const cur = map.get(r.emoji) ?? { count: 0, byMe: false };
      cur.count += 1;
      if (meId && r.userId === meId) cur.byMe = true;
      map.set(r.emoji, cur);
    }
    return [...map.entries()];
  }, [msg.reactions, meId]);
  // assistant messages render as streaming markdown instead of mention-chip rich text
  const isAi = !!msg.llmConnectionId;

  async function handleEdit() {
    if (!editContent.trim()) return;
    await api.editMessage(msg.id, editContent.trim());
    setEditing(false);
  }

  async function handleDelete() {
    if (!confirm("Delete this message?")) return;
    await api.deleteMessage(msg.id);
  }

  async function toggleReaction(emoji: string, byMe: boolean) {
    try {
      if (byMe) await api.unreact(msg.id, emoji);
      else await api.react(msg.id, emoji);
    } catch {
      // idempotent on the server — refetch to resync on failure
    }
  }

  if (msg.deletedAt) {
    return (
      <div className="px-4 py-2 text-sm text-[var(--muted-foreground)] italic border-l-2 border-[var(--border)] ml-2">Message deleted</div>
    );
  }

  return (
    <div
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className="relative hover:bg-[var(--muted)]/60"
    >
      {/* AI Elements preset alignment: own → right bubble, others → left */}
      <Message
        from={isOwn ? "user" : "assistant"}
        className={`max-w-full gap-1 px-4 py-1.5 ${isOwn ? "" : ""}`}
      >
        {/* header: avatar + name + time (mirrored for own messages) */}
        <div className={`flex items-baseline gap-2 text-xs ${isOwn ? "self-end flex-row-reverse" : ""}`}>
          <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[var(--primary-foreground)] shrink-0 bg-gradient-to-br ${isAi ? "from-[var(--accent)]" : "from-[var(--primary)]"} to-[var(--accent)] translate-y-0.5`}>
            <span className="text-[9px] font-semibold">{(msg.sender?.name ?? "?").slice(0, 2).toUpperCase()}</span>
          </span>
          <span className="text-[13px] font-semibold text-[var(--foreground)]">{msg.sender?.name ?? "Unknown"}</span>
          <span className="text-[11px] text-[var(--muted-foreground)]">{time}</span>
          {msg.editedAt && <span className="text-[11px] text-[var(--muted-foreground)]">(edited)</span>}
        </div>

        {/* reasoning collapsible stays outside the bubble, full width of its side */}
        {msg.reasoning ? (
          <Reasoning className={`${isOwn ? "self-end" : ""} w-fit max-w-full`} defaultOpen={false}>
            <ReasoningTrigger className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              <BrainCircuit className="h-3.5 w-3.5" /> Thinking
            </ReasoningTrigger>
            <ReasoningContent className="max-h-64 overflow-y-auto break-words text-xs text-[var(--muted-foreground)]">
              {msg.reasoning}
            </ReasoningContent>
          </Reasoning>
        ) : null}

        <MessageContent className={isOwn ? "text-[13px]" : "text-sm"}>
          {editing ? (
            <div className="flex gap-2 py-1">
              <input value={editContent} onChange={(e) => setEditContent(e.target.value)} className="flex-1 rounded-[var(--radius-sm)] border border-[var(--input-border)] bg-[var(--input)] text-[var(--foreground)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
              <button onClick={handleEdit} className="text-xs bg-[var(--primary)] text-[var(--primary-foreground)] px-3 py-1 rounded-[var(--radius-sm)]">Save</button>
              <button onClick={() => setEditing(false)} className="text-xs border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] px-3 py-1 rounded-[var(--radius-sm)]">Cancel</button>
            </div>
          ) : isAi ? (
            <MessageResponse className="break-words [&>*:first-child]:mt-0">{msg.content}</MessageResponse>
          ) : (
            <RichText content={msg.content} memberTokens={memberTokens ?? new Set()} meName={meName} inverted={isOwn} />
          )}

          {msg.attachments && msg.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {msg.attachments.map((a) => (
                <AttachmentPreview key={a.key} att={a} />
              ))}
            </div>
          )}

          {groupedReactions.length > 0 && (
            <div className="mt-1.5 flex gap-1 flex-wrap">
              {groupedReactions.map(([emoji, { count, byMe }]) => (
                <button
                  key={emoji}
                  onClick={() => toggleReaction(emoji, byMe)}
                  aria-pressed={byMe}
                  title={byMe ? "Click to remove your reaction" : "React"}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    isOwn
                      ? // inside own primary bubble: light pills for contrast on teal
                        byMe
                          ? "border-white/60 bg-white/25 text-[var(--primary-foreground)] font-semibold"
                          : "border-white/30 bg-white/10 text-[var(--primary-foreground)]/90 hover:bg-white/20"
                      : byMe
                        ? "border-[var(--primary)] bg-[var(--primary)]/15 text-[var(--primary)] font-semibold"
                        : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] text-[var(--foreground)]"
                  }`}
                >
                  {/* reactions are emoji content, not UI chrome */}
                  <span>{emoji}</span><span className={byMe || isOwn ? "" : "text-[var(--muted-foreground)]"}>{count}</span>
                </button>
              ))}
            </div>
          )}

          {readBy && readBy.length > 0 && (
            <div className={`mt-1 flex items-center gap-1 ${isOwn ? "justify-start" : "justify-end"}`} title={`Read by ${readBy.map((r) => r.name).join(", ")}`}>
              {readBy.slice(0, 4).map((r) => (
                <span
                  key={r.id}
                  className="h-5 w-5 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] text-[var(--primary-foreground)] text-[9px] font-bold flex items-center justify-center ring-2 ring-[var(--card)] -ml-1 first:ml-0"
                  title={r.name}
                >
                  {String(r.name ?? "?").slice(0, 2).toUpperCase()}
                </span>
              ))}
              {readBy.length > 4 && <span className="text-xs text-[var(--muted-foreground)] ml-1">+{readBy.length - 4}</span>}
            </div>
          )}
        </MessageContent>
      </Message>

      {showActions && !editing && (
        <MessageActions className="absolute -top-3 right-4 rounded-full border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)] px-1 py-1 z-10">
          <MessageAction tooltip="Thumbs up" onClick={() => toggleReaction("👍", groupedReactions.find(([e]) => e === "👍")?.[1].byMe ?? false)}><ThumbsUp className="h-3.5 w-3.5" /></MessageAction>
          <MessageAction tooltip="Heart" onClick={() => toggleReaction("❤️", groupedReactions.find(([e]) => e === "❤️")?.[1].byMe ?? false)}><Heart className="h-3.5 w-3.5" /></MessageAction>
          <MessageAction tooltip="Laugh" onClick={() => toggleReaction("😂", groupedReactions.find(([e]) => e === "😂")?.[1].byMe ?? false)}><Laugh className="h-3.5 w-3.5" /></MessageAction>
          {onReply && <MessageAction tooltip="Reply" onClick={() => onReply(msg.id)}><CornerUpLeft className="h-3.5 w-3.5" /></MessageAction>}
          {isOwn && (
            <>
              <MessageAction tooltip="Edit" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /></MessageAction>
              <MessageAction tooltip="Delete" onClick={handleDelete} className="text-[var(--destructive)] hover:bg-red-50 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /></MessageAction>
            </>
          )}
        </MessageActions>
      )}
    </div>
  );
}

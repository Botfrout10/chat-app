"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { RichText, AttachmentPreview } from "./RichText";
import { BrainCircuit, CornerUpLeft, Pencil, ThumbsUp, Heart, Laugh, Trash2 } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { MessageAction, MessageActions } from "@/components/ai-elements/message";

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

export function MessageItem({ msg, onReply, isOwn, memberTokens, meName, readBy }: { msg: Msg; onReply?: (id: string) => void; isOwn?: boolean; memberTokens?: Set<string>; meName?: string; readBy?: { id: string; name: string; image?: string | null }[] }) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(msg.content);
  const [showActions, setShowActions] = useState(false);

  const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const groupedReactions = (msg.reactions ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
    return acc;
  }, {});
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

  async function react(emoji: string) {
    await api.react(msg.id, emoji);
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
      className={`group relative flex gap-3 px-4 py-2 hover:bg-[var(--muted)]/60 ${isOwn ? "bg-[var(--accent-50)] dark:bg-white/[0.03] border-l-2 border-[var(--accent-300)]" : "border-l-2 border-transparent"}`}
    >
      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[var(--primary-foreground)] shrink-0 shadow-[var(--shadow-soft)] bg-gradient-to-br ${isAi ? "from-[var(--accent)]" : "from-[var(--primary)]"} to-[var(--accent)]`}>
        <span className="text-xs font-semibold">{(msg.sender?.name ?? "?").slice(0, 2).toUpperCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-[var(--foreground)]">{msg.sender?.name ?? "Unknown"}</span>
          <span className="text-xs text-[var(--muted-foreground)]">{time}</span>
          {msg.editedAt && <span className="text-xs text-[var(--muted-foreground)]">(edited)</span>}
        </div>

        {msg.reasoning ? (
          <Reasoning className="mt-1 mb-1 w-full max-w-full" defaultOpen={false}>
            <ReasoningTrigger className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              <BrainCircuit className="h-3.5 w-3.5" /> Thinking
            </ReasoningTrigger>
            <ReasoningContent className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs text-[var(--muted-foreground)]">
              {msg.reasoning}
            </ReasoningContent>
          </Reasoning>
        ) : null}

        {editing ? (
          <div className="mt-1 flex gap-2">
            <input value={editContent} onChange={(e) => setEditContent(e.target.value)} className="flex-1 rounded-[var(--radius-sm)] border border-[var(--input-border)] bg-[var(--input)] text-[var(--foreground)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
            <button onClick={handleEdit} className="text-xs bg-[var(--primary)] text-[var(--primary-foreground)] px-3 py-1 rounded-[var(--radius-sm)]">Save</button>
            <button onClick={() => setEditing(false)} className="text-xs border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] px-3 py-1 rounded-[var(--radius-sm)]">Cancel</button>
          </div>
        ) : isAi ? (
          <MessageResponse className="text-sm break-words [&>*:first-child]:mt-0">{msg.content}</MessageResponse>
        ) : (
          <RichText content={msg.content} memberTokens={memberTokens ?? new Set()} meName={meName} />
        )}

        {msg.attachments && msg.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.attachments.map((a) => (
              <AttachmentPreview key={a.key} att={a} />
            ))}
          </div>
        )}

        {Object.keys(groupedReactions).length > 0 && (
          <div className="mt-2 flex gap-1 flex-wrap">
            {Object.entries(groupedReactions).map(([emoji, count]) => (
              <button key={emoji} onClick={() => react(emoji)} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-xs hover:bg-[var(--muted)] text-[var(--foreground)]">
                {/* reactions are emoji content, not UI chrome */}
                <span>{emoji}</span><span className="text-[var(--muted-foreground)]">{count}</span>
              </button>
            ))}
          </div>
        )}

        {readBy && readBy.length > 0 && (
          <div className="mt-1 flex items-center justify-end gap-1" title={`Read by ${readBy.map((r) => r.name).join(", ")}`}>
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
      </div>

      {showActions && !editing && (
        <MessageActions className="absolute -top-3 right-4 rounded-full border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)] px-1 py-1 z-10">
          <MessageAction tooltip="Thumbs up" onClick={() => react("👍")}><ThumbsUp className="h-3.5 w-3.5" /></MessageAction>
          <MessageAction tooltip="Heart" onClick={() => react("❤️")}><Heart className="h-3.5 w-3.5" /></MessageAction>
          <MessageAction tooltip="Laugh" onClick={() => react("😂")}><Laugh className="h-3.5 w-3.5" /></MessageAction>
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

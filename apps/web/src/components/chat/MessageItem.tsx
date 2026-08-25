"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { RichText, AttachmentPreview } from "./RichText";

type Msg = {
  id: string;
  content: string;
  reasoning?: string | null;
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
      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center text-[var(--primary-foreground)] text-xs font-semibold shrink-0 shadow-[var(--shadow-soft)]">
        {(msg.sender?.name ?? "?").slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-[var(--foreground)]">{msg.sender?.name ?? "Unknown"}</span>
          <span className="text-xs text-[var(--muted-foreground)]">{time}</span>
          {msg.editedAt && <span className="text-xs text-[var(--muted-foreground)]">(edited)</span>}
        </div>

        {msg.reasoning ? (
          <details className="mt-1 mb-1">
            <summary className="cursor-pointer select-none text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              🧠 Thinking
            </summary>
            <div className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-[var(--border)] pl-3 text-xs text-[var(--muted-foreground)]">
              {msg.reasoning}
            </div>
          </details>
        ) : null}

        {editing ? (
          <div className="mt-1 flex gap-2">
            <input value={editContent} onChange={(e) => setEditContent(e.target.value)} className="flex-1 rounded-[var(--radius-sm)] border border-[var(--input-border)] bg-[var(--input)] text-[var(--foreground)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
            <button onClick={handleEdit} className="text-xs bg-[var(--primary)] text-[var(--primary-foreground)] px-3 py-1 rounded-[var(--radius-sm)]">Save</button>
            <button onClick={() => setEditing(false)} className="text-xs border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] px-3 py-1 rounded-[var(--radius-sm)]">Cancel</button>
          </div>
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
        <div className="absolute -top-3 right-4 flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)] px-1 py-1">
          <button onClick={() => react("👍")} className="h-6 w-6 rounded-full hover:bg-[var(--muted)] text-xs">👍</button>
          <button onClick={() => react("❤️")} className="h-6 w-6 rounded-full hover:bg-[var(--muted)] text-xs">❤️</button>
          <button onClick={() => react("😂")} className="h-6 w-6 rounded-full hover:bg-[var(--muted)] text-xs">😂</button>
          {onReply && <button onClick={() => onReply(msg.id)} className="h-6 px-2 rounded-full hover:bg-[var(--muted)] text-xs text-[var(--foreground)]">↩</button>}
          {isOwn && (
            <>
              <button onClick={() => setEditing(true)} className="h-6 px-2 rounded-full hover:bg-[var(--muted)] text-xs text-[var(--foreground)]">✎</button>
              <button onClick={handleDelete} className="h-6 px-2 rounded-full hover:bg-red-50 text-[var(--destructive)] text-xs">🗑</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

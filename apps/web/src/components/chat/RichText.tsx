"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { useLightbox } from "@/components/ui/ImageLightbox";

const SPLIT = /(@[\p{L}\p{N}_.-]+)/gu;

function fmtSize(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function MentionChip({ token, isMe, isKnown }: { token: string; isMe: boolean; isKnown: boolean }) {
  const base = "rounded px-1 font-medium";
  const cls = isMe
    ? `${base} bg-[var(--primary)] text-[var(--primary-foreground)]`
    : isKnown
      ? `${base} bg-[var(--accent-100)] text-[var(--accent-700)] dark:bg-teal-900/40 dark:text-[var(--accent-300)]`
      : `${base} bg-[var(--muted)] text-[var(--muted-foreground)]`;
  return <span className={cls}>{token}</span>;
}

const mdComponents = {
  p: ({ children }: any) => <span className="block">{children}</span>,
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-[var(--primary)] underline underline-offset-2 hover:text-[var(--primary-hover)]">{children}</a>
  ),
  code: ({ className, children, ...props }: any) => {
    const isBlock = /language-/.test(className ?? "") || String(children).includes("\n");
    if (isBlock) {
      return <pre className="my-1 overflow-x-auto rounded-lg bg-[var(--muted)] border border-[var(--border)] p-2.5 text-xs font-mono"><code>{children}</code></pre>;
    }
    return <code className="rounded bg-[var(--muted)] border border-[var(--border)] px-1 py-0.5 text-[0.85em] font-mono" {...props}>{children}</code>;
  },
  pre: ({ children }: any) => <>{children}</>,
  ul: ({ children }: any) => <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>,
  blockquote: ({ children }: any) => <blockquote className="border-l-2 border-[var(--accent-300)] pl-2 my-1 text-[var(--muted-foreground)] italic">{children}</blockquote>,
  h1: ({ children }: any) => <span className="block text-base font-bold my-1">{children}</span>,
  h2: ({ children }: any) => <span className="block text-sm font-bold my-1">{children}</span>,
  h3: ({ children }: any) => <span className="block text-sm font-semibold my-1">{children}</span>,
  table: ({ children }: any) => <div className="overflow-x-auto my-1"><table className="text-xs border-collapse border border-[var(--border)]">{children}</table></div>,
  th: ({ children }: any) => <th className="border border-[var(--border)] bg-[var(--muted)] px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }: any) => <td className="border border-[var(--border)] px-2 py-1">{children}</td>,
};

export function RichText({ content, memberTokens, meName }: { content: string; memberTokens: Set<string>; meName?: string }) {
  const parts = content.split(SPLIT);
  return (
    <div className="text-sm leading-relaxed break-words">
      {parts.map((part, i) => {
        if (part.startsWith("@") && part.length > 1 && SPLIT.test(part)) {
          SPLIT.lastIndex = 0;
          const name = part.slice(1);
          const isKnown = memberTokens.has(name.toLowerCase());
          const isMe = !!meName && name.toLowerCase() === meName.toLowerCase();
          return <MentionChip key={i} token={part} isMe={isMe} isKnown={isKnown} />;
        }
        if (!part) return null;
        return (
          <span key={i} className="[&_p]:m-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as any}>
              {part}
            </ReactMarkdown>
          </span>
        );
      })}
    </div>
  );
}

export function AttachmentPreview({ att }: { att: { key: string; filename: string; mime?: string; size?: number } }) {
  const url = fileUrlFor(att.key);
  const mime = att.mime ?? "";
  if (mime.startsWith("image/")) {
    return <ImageThumb url={url} alt={att.filename} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 hover:bg-[var(--muted)] w-fit">
      <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[var(--foreground)] truncate max-w-[220px]">{att.filename}</span>
        <span className="block text-xs text-[var(--muted-foreground)]">{fmtSize(att.size)}</span>
      </span>
    </a>
  );
}

function ImageThumb({ url, alt }: { url: string; alt: string }) {
  const { open } = useLightbox();
  return (
    <button type="button" onClick={() => open(url, alt)} className="inline-block max-w-[320px] rounded-xl overflow-hidden border border-[var(--border)] hover:opacity-90 transition-opacity">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="max-h-56 w-auto max-w-full object-cover" />
    </button>
  );
}

function fileUrlFor(key: string) {
  // lazy import-free copy of lib/api helper to keep this component standalone-safe
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const MINIO_URL = process.env.NEXT_PUBLIC_MINIO_URL ?? API_URL.replace(":3001", ":9000");
  const BUCKET = process.env.NEXT_PUBLIC_S3_BUCKET ?? "chat-attachments";
  return `${MINIO_URL}/${BUCKET}/${key}`;
}

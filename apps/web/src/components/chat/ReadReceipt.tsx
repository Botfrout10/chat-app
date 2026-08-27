"use client";
import { Check, CheckCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ReadBy = { id: string; name: string };

export function DmReadReceipt({ status }: { status: "sent" | "read" }) {
  const isRead = status === "read";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center">
            {isRead ? (
              <CheckCheck className="h-3.5 w-3.5 text-[var(--primary)]" />
            ) : (
              <Check className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {isRead ? "Read" : "Sent"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AiReadReceipt({ status }: { status: "sent" | "read" }) {
  const isRead = status === "read";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center">
            {isRead ? (
              <CheckCheck className="h-3.5 w-3.5 text-[var(--accent)]" />
            ) : (
              <Check className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {isRead ? "Processed by model" : "Sent to model"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ChannelReadReceipt({ readBy }: { readBy: ReadBy[] }) {
  if (!readBy.length) return null;
  // show abbreviations as subtle pills, not circles — max 4 + count
  const shown = readBy.slice(0, 4);
  const extra = readBy.length - shown.length;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 justify-end">
      {shown.map((r) => (
        <TooltipProvider key={r.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="px-1.5 py-0 text-[10px] font-medium tracking-widest bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)] rounded-md"
              >
                {String(r.name ?? "?").slice(0, 2).toUpperCase()}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Seen by {r.name}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
      {extra > 0 && (
        <span className="text-[11px] text-[var(--muted-foreground)]">+{extra}</span>
      )}
    </div>
  );
}

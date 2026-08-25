"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, ChevronDown, ChevronRight, Plug } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useUiStore } from "@/store/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const STATUS_DOT: Record<string, string> = {
  ok: "bg-[var(--success)]",
  error: "bg-[var(--destructive)]",
  unverified: "bg-[var(--warning)]",
};

type StatusDetail = {
  connection: any;
  providerReachable: boolean;
  providerModels: string[] | null;
};

export function LlmManager() {
  const { dialog, closeDialog } = useUiStore();
  const open = dialog === "llmManager";
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const { data: connections } = useQuery({
    queryKey: ["llm-connections"],
    queryFn: () => api.llmConnections().catch(() => []),
    enabled: open,
  });
  const { data: statusDetail } = useQuery<StatusDetail>({
    queryKey: ["llm-status", openStatusId],
    queryFn: () => api.llmConnectionStatus(openStatusId!),
    enabled: open && !!openStatusId,
  });

  useEffect(() => {
    if (!open) setOpenStatusId(null);
  }, [open]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !baseUrl.trim() || !modelId.trim()) return;
    setBusy(true);
    try {
      await api.createLlmConnection({ label: label.trim(), baseUrl: baseUrl.trim(), modelId: modelId.trim() });
      setLabel(""); setModelId("");
      qc.invalidateQueries({ queryKey: ["llm-connections"] });
      toast.success(`Connected ${label.trim()}`);
    } catch (e: any) {
      let msg = e.message ?? "Connection failed";
      try { msg = JSON.parse(msg)?.error ?? msg; } catch {}
      toast.error(String(msg).slice(0, 300));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.deleteLlmConnection(id).catch(() => {});
    if (openStatusId === id) setOpenStatusId(null);
    qc.invalidateQueries({ queryKey: ["llm-connections"] });
    toast.success("Model connection removed");
  }

  async function verify(id: string) {
    await api.verifyLlmConnection(id).catch(() => {});
    qc.invalidateQueries({ queryKey: ["llm-connections"] });
    if (openStatusId === id) qc.invalidateQueries({ queryKey: ["llm-status", id] });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BrainCircuit className="h-4 w-4" /> AI models</DialogTitle>
            <DialogDescription>Connect a local or cloud LLM via an OpenAI-compatible endpoint.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {(connections as any[])?.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">No models connected yet — add your first below.</p>
            )}
            {(connections as any[])?.map((c: any) => (
              <div key={c.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] overflow-hidden">
                <button
                  onClick={() => setOpenStatusId(openStatusId === c.id ? null : c.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--muted)]"
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[c.status] ?? "bg-[var(--warning)]"}`} />
                  <span className="text-sm font-medium text-[var(--foreground)] truncate">{c.label}</span>
                  <span className="text-xs text-[var(--muted-foreground)] truncate">@{c.mentionName} · {c.modelId}</span>
                  <span className="ml-auto text-[var(--muted-foreground)]">
                    {openStatusId === c.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                </button>

                {c.status === "error" && c.lastError && (
                  <div className="px-3 pb-2 text-xs text-[var(--destructive)]">{c.lastError}</div>
                )}

                {openStatusId === c.id && (
                  <div className="border-t border-[var(--border)] px-3 py-3 space-y-2 text-xs">
                    {!statusDetail ? (
                      <div className="text-[var(--muted-foreground)]">Loading status…</div>
                    ) : (
                      <>
                        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
                          <span className="text-[var(--muted-foreground)]">Endpoint</span><span className="text-[var(--foreground)] font-mono break-all">{statusDetail.connection.baseUrl}</span>
                          <span className="text-[var(--muted-foreground)]">Model</span><span className="text-[var(--foreground)] font-mono break-all">{statusDetail.connection.modelId}</span>
                          <span className="text-[var(--muted-foreground)]">Mention as</span><span className="text-[var(--foreground)]">@{statusDetail.connection.mentionName}</span>
                          <span className="text-[var(--muted-foreground)]">Provider</span>
                          <span className={statusDetail.providerReachable ? "text-[var(--success)]" : "text-[var(--destructive)]"}>
                            {statusDetail.providerReachable ? `reachable · ${statusDetail.providerModels?.length ?? 0} model(s)` : "unreachable"}
                          </span>
                          <span className="text-[var(--muted-foreground)]">Last checked</span><span className="text-[var(--foreground)]">{new Date(statusDetail.connection.lastCheckedAt).toLocaleString()}</span>
                        </div>
                        {statusDetail.providerModels != null && !statusDetail.providerModels.includes(statusDetail.connection.modelId) && (
                          <div className="text-[var(--destructive)]">Model not in provider list — it may have been unloaded.</div>
                        )}
                        {statusDetail.providerModels && statusDetail.providerModels.length > 0 && (
                          <details>
                            <summary className="cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Provider models</summary>
                            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
                              {statusDetail.providerModels.map((m) => <li key={m}>· {m}</li>)}
                            </ul>
                          </details>
                        )}
                      </>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => verify(c.id)}>Re-check</Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => setRemoveId(c.id)}>Remove</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={connect} className="space-y-2 border-t border-[var(--border)] pt-4">
            <div className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)]">CONNECT A MODEL</div>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Display label (e.g. Qwen local)" />
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:1234 (LM Studio default)" className="font-mono" />
            <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="Model name exactly as the provider reports it" className="font-mono" />
            <Button type="submit" disabled={busy || !label.trim() || !baseUrl.trim() || !modelId.trim()} className="w-full">
              <Plug className="h-4 w-4" />{busy ? "Verifying…" : "Connect"}
            </Button>
            <p className="text-xs text-[var(--muted-foreground)]">
              The model is verified against <code>{"{base}/models"}</code> on save. Local example: LM Studio → Developer → Start server.
            </p>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove model connection?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing AI chats stay readable, but the model will no longer respond to mentions or new messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => { if (removeId) remove(removeId); setRemoveId(null); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

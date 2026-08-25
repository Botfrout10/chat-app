"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui/button";

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

export function LlmManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234");
  const [modelId, setModelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);

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
    if (!open) { setError(null); setOpenStatusId(null); }
  }, [open]);

  if (!open) return null;

  async function connect() {
    setError(null);
    if (!label.trim() || !baseUrl.trim() || !modelId.trim()) { setError("Label, base URL and model name are all required."); return; }
    setBusy(true);
    try {
      await api.createLlmConnection({ label: label.trim(), baseUrl: baseUrl.trim(), modelId: modelId.trim() });
      setLabel(""); setModelId("");
      qc.invalidateQueries({ queryKey: ["llm-connections"] });
    } catch (e: any) {
      let msg = e.message ?? "Connection failed";
      try { msg = JSON.parse(msg)?.error ?? msg; } catch {}
      setError(String(msg).slice(0, 300));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this model connection?")) return;
    await api.deleteLlmConnection(id).catch(() => {});
    if (openStatusId === id) setOpenStatusId(null);
    qc.invalidateQueries({ queryKey: ["llm-connections"] });
  }

  async function verify(id: string) {
    await api.verifyLlmConnection(id).catch(() => {});
    qc.invalidateQueries({ queryKey: ["llm-connections"] });
    if (openStatusId === id) qc.invalidateQueries({ queryKey: ["llm-status", id] });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">AI models</h2>
            <p className="text-xs text-[var(--muted-foreground)]">Connect a local or cloud LLM via an OpenAI-compatible endpoint.</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {(connections as any[])?.length === 0 && (
            <p className="text-xs text-[var(--muted-foreground)]">No models connected yet — add your first below.</p>
          )}
          {(connections as any[])?.map((c: any) => (
            <div key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
              <button
                onClick={() => setOpenStatusId(openStatusId === c.id ? null : c.id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--muted)]"
              >
                <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[c.status] ?? "bg-[var(--warning)]"}`} />
                <span className="text-sm font-medium text-[var(--foreground)] truncate">{c.label}</span>
                <span className="text-xs text-[var(--muted-foreground)] truncate">@{c.mentionName} · {c.modelId}</span>
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">{openStatusId === c.id ? "▾" : "▸"}</span>
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
                    <Button size="sm" variant="outline" onClick={() => verify(c.id)}>Re-check</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c.id)} className="text-[var(--destructive)]">Remove</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--border)] p-5 space-y-2">
          <div className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)]">CONNECT A MODEL</div>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Display label (e.g. Qwen local)" className="h-9 text-sm" />
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:1234 (LM Studio default)" className="h-9 text-sm font-mono" />
          <Input value={modelId} onChange={(e) => setModelId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connect()} placeholder="Model name exactly as the provider reports it" className="h-9 text-sm font-mono" />
          {error && <div className="text-xs text-red-200 bg-red-950/40 border border-red-800/50 rounded-lg p-2 text-red-600 dark:text-red-200">{error}</div>}
          <Button onClick={connect} disabled={busy || !label.trim() || !baseUrl.trim() || !modelId.trim()} className="w-full h-9">
            {busy ? "Verifying…" : "Connect"}
          </Button>
          <p className="text-xs text-[var(--muted-foreground)]">
            The model is verified against <code>{"{base}/models"}</code> on save. Local example: LM Studio → Developer → Start server.
          </p>
        </div>
      </div>
    </div>
  );
}

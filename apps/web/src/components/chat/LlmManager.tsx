"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, ChevronDown, ChevronRight, Plug, RefreshCw, Eye, EyeOff } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

function isValidUrl(s: string) {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export function LlmManager() {
  const { dialog, closeDialog } = useUiStore();
  const open = dialog === "llmManager";
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [debouncedBaseUrl, setDebouncedBaseUrl] = useState(baseUrl);
  const [debouncedApiKey, setDebouncedApiKey] = useState(apiKey);

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

  // debounce URL + key for preview fetch (500ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBaseUrl(baseUrl.trim()), 500);
    return () => clearTimeout(t);
  }, [baseUrl]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedApiKey(apiKey.trim()), 500);
    return () => clearTimeout(t);
  }, [apiKey]);

  const canPreview = open && !!debouncedBaseUrl && isValidUrl(debouncedBaseUrl);
  const {
    data: preview,
    isFetching: previewLoading,
    error: previewErrorRaw,
    refetch: refetchPreview,
  } = useQuery({
    queryKey: ["llm-preview", debouncedBaseUrl, debouncedApiKey ? "key" : "nokey"],
    queryFn: async () => {
      try {
        const res: any = await api.llmPreview(debouncedBaseUrl, debouncedApiKey || undefined);
        return res as { providerReachable: boolean; providerModels: string[] | null; baseUrl: string };
      } catch (e: any) {
        let msg = e.message ?? "Preview failed";
        try {
          const parsed = JSON.parse(msg);
          msg = parsed.error ?? msg;
        } catch {}
        throw new Error(msg);
      }
    },
    enabled: canPreview,
    retry: false,
    staleTime: 30_000,
  });
  const previewError = (previewErrorRaw as Error | null)?.message ?? null;
  const providerModels: string[] | null = (preview as any)?.providerModels ?? null;
  const providerReachable = !previewError && !!providerModels;

  // when models load, auto-select first if none selected, and reset if baseUrl changed
  useEffect(() => {
    if (providerModels && providerModels.length > 0) {
      if (!modelId || !providerModels.includes(modelId)) {
        // keep current if still valid, otherwise clear to force selection
        if (!providerModels.includes(modelId)) setModelId("");
      }
    } else if (previewError) {
      // keep manual modelId for fallback input
    }
  }, [providerModels, previewError]); // eslint-disable-line react-hooks/exhaustive-deps

  // when baseUrl changes to a new value, clear stale model selection
  useEffect(() => {
    setModelId("");
  }, [debouncedBaseUrl, debouncedApiKey]);

  useEffect(() => {
    if (!open) setOpenStatusId(null);
  }, [open]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !baseUrl.trim() || !modelId.trim()) return;
    setBusy(true);
    try {
      await api.createLlmConnection({
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setLabel("");
      setModelId("");
      setApiKey("");
      qc.invalidateQueries({ queryKey: ["llm-connections"] });
      toast.success(`Connected ${label.trim()}`);
    } catch (e: any) {
      let msg = e.message ?? "Connection failed";
      try {
        msg = JSON.parse(msg)?.error ?? msg;
      } catch {}
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
            <DialogTitle className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4" /> AI models
            </DialogTitle>
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
                          <span className="text-[var(--muted-foreground)]">Endpoint</span>
                          <span className="text-[var(--foreground)] font-mono break-all">{statusDetail.connection.baseUrl}</span>
                          <span className="text-[var(--muted-foreground)]">Model</span>
                          <span className="text-[var(--foreground)] font-mono break-all">{statusDetail.connection.modelId}</span>
                          <span className="text-[var(--muted-foreground)]">Mention as</span>
                          <span className="text-[var(--foreground)]">@{statusDetail.connection.mentionName}</span>
                          <span className="text-[var(--muted-foreground)]">Provider</span>
                          <span className={statusDetail.providerReachable ? "text-[var(--success)]" : "text-[var(--destructive)]"}>
                            {statusDetail.providerReachable ? `reachable · ${statusDetail.providerModels?.length ?? 0} model(s)` : "unreachable"}
                          </span>
                          <span className="text-[var(--muted-foreground)]">Last checked</span>
                          <span className="text-[var(--foreground)]">{new Date(statusDetail.connection.lastCheckedAt).toLocaleString()}</span>
                        </div>
                        {statusDetail.providerModels != null && !statusDetail.providerModels.includes(statusDetail.connection.modelId) && (
                          <div className="text-[var(--destructive)]">Model not in provider list — it may have been unloaded.</div>
                        )}
                        {statusDetail.providerModels && statusDetail.providerModels.length > 0 && (
                          <details>
                            <summary className="cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Provider models</summary>
                            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
                              {statusDetail.providerModels.map((m) => (
                                <li key={m}>· {m}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => verify(c.id)}>
                        Re-check
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => setRemoveId(c.id)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={connect} className="space-y-3 border-t border-[var(--border)] pt-4">
            <div className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)]">CONNECT A MODEL</div>

            {/* URL first — drives model list */}
            <div className="space-y-1.5">
              <Label htmlFor="llm-baseUrl" className="text-xs text-[var(--muted-foreground)]">
                Provider URL
              </Label>
              <div className="flex gap-2">
                <Input
                  id="llm-baseUrl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:1234 (LM Studio default)"
                  className="font-mono flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => refetchPreview()}
                  disabled={!isValidUrl(baseUrl.trim())}
                  title="Refresh models from URL"
                >
                  <RefreshCw className={`h-4 w-4 ${previewLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                OpenAI-compatible base URL. We fetch <code>{"{base}/models"}</code> to list models.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="llm-apiKey" className="text-xs text-[var(--muted-foreground)]">
                API key <span className="font-normal opacity-60">(required for cloud providers, leave blank for local)</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="llm-apiKey"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-… (stored encrypted)"
                  className="font-mono flex-1"
                  autoComplete="off"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((v) => !v)} title={showKey ? "Hide key" : "Show key"}>
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Model selectable list based on URL */}
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--muted-foreground)]">Model</Label>
              {previewLoading ? (
                <div className="h-9 rounded-md border border-[var(--border)] bg-[var(--muted)] flex items-center px-3 text-xs text-[var(--muted-foreground)]">
                  Loading models…
                </div>
              ) : providerModels && providerModels.length > 0 ? (
                <Select value={modelId} onValueChange={setModelId}>
                  <SelectTrigger className="w-full font-mono">
                    <SelectValue placeholder="Select a model from provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providerModels.map((m) => (
                      <SelectItem key={m} value={m} className="font-mono">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : previewError ? (
                <>
                  <div className="rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
                    {previewError}
                  </div>
                  <Input
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    placeholder="Model name exactly as provider reports it (fallback)"
                    className="font-mono"
                  />
                </>
              ) : !isValidUrl(baseUrl.trim()) ? (
                <div className="h-9 rounded-md border border-dashed border-[var(--border)] flex items-center px-3 text-xs text-[var(--muted-foreground)]">
                  Enter a valid URL to load models
                </div>
              ) : (
                <div className="h-9 rounded-md border border-dashed border-[var(--border)] flex items-center px-3 text-xs text-[var(--muted-foreground)]">
                  No models found — check provider is running
                </div>
              )}
              {providerModels && providerModels.length > 0 && (
                <p className="text-[11px] text-[var(--muted-foreground)]">{providerModels.length} model(s) available</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="llm-label" className="text-xs text-[var(--muted-foreground)]">
                Display label
              </Label>
              <Input id="llm-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Display label (e.g. Qwen local)" />
            </div>

            <Button type="submit" disabled={busy || !label.trim() || !baseUrl.trim() || !modelId.trim()} className="w-full">
              <Plug className="h-4 w-4" />
              {busy ? "Verifying…" : "Connect"}
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
              onClick={() => {
                if (removeId) remove(removeId);
                setRemoveId(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

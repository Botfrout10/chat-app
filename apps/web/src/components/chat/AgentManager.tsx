"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronRight, Plug, RefreshCw, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { useChatStore } from "@/store/chat";
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
  online: "bg-[var(--success)]",
  pending: "bg-[var(--warning)]",
  offline: "bg-[var(--muted-foreground)]",
  error: "bg-[var(--destructive)]",
};

type StatusDetail = {
  registration: any;
  providerReachable: boolean | null;
  capabilities: unknown;
  machineMetadata: unknown;
};

function isValidUrl(s: string) {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export function AgentManager() {
  const { dialog, closeDialog } = useUiStore();
  const open = dialog === "agentManager";
  const qc = useQueryClient();
  const workspaces = useChatStore((s) => s.workspaces);
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);

  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [endpoint, setEndpoint] = useState("http://localhost:4096");
  const [authSecret, setAuthSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [transport, setTransport] = useState<"network" | "stdio">("network");
  const [busy, setBusy] = useState(false);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  useEffect(() => {
    if (open && !workspaceId && activeWorkspaceId) setWorkspaceId(activeWorkspaceId);
  }, [open, activeWorkspaceId, workspaceId]);
  useEffect(() => {
    if (!open) setOpenStatusId(null);
  }, [open]);

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => (api as any).agents().catch(() => []),
    enabled: open,
  });
  const { data: statusDetail } = useQuery<StatusDetail>({
    queryKey: ["agent-status", openStatusId],
    queryFn: () => (api as any).agentStatus(openStatusId!),
    enabled: open && !!openStatusId,
  });

  // preview for network transport
  const canPreview = open && transport === "network" && !!endpoint && isValidUrl(endpoint);
  const {
    data: preview,
    isFetching: previewLoading,
    error: previewErrorRaw,
  } = useQuery({
    queryKey: ["agent-preview", endpoint, transport],
    queryFn: async () => {
      try {
        const res: any = await (api as any).agentPreview({ endpoint, ...(authSecret.trim() ? { authSecret: authSecret.trim() } : {}), transport });
        return res as { providerReachable: boolean; capabilities: unknown };
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

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !workspaceId) return;
    if (transport === "network" && !endpoint.trim()) return;
    setBusy(true);
    try {
      await (api as any).createAgent({
        name: name.trim(),
        workspaceId,
        transport,
        ...(transport === "network" ? { endpoint: endpoint.trim() } : {}),
        ...(authSecret.trim() ? { authSecret: authSecret.trim() } : {}),
      });
      setName("");
      setAuthSecret("");
      qc.invalidateQueries({ queryKey: ["agents"] });
      toast.success(`Agent ${name.trim()} registered`);
    } catch (e: any) {
      let msg = e.message ?? "Failed";
      try {
        msg = JSON.parse(msg)?.error ?? msg;
      } catch {}
      toast.error(String(msg).slice(0, 300));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await (api as any).deleteAgent(id).catch(() => {});
    if (openStatusId === id) setOpenStatusId(null);
    qc.invalidateQueries({ queryKey: ["agents"] });
    toast.success("Agent removed");
  }

  async function verify(id: string) {
    await (api as any).verifyAgent(id).catch(() => {});
    qc.invalidateQueries({ queryKey: ["agents"] });
    if (openStatusId === id) qc.invalidateQueries({ queryKey: ["agent-status", id] });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4" /> Agents
            </DialogTitle>
            <DialogDescription>Connect an external agent over ACP (e.g. <code>opencode serve</code>). Each agent is bound to a workspace.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {(agents as any[])?.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">No agents connected yet — add your first below.</p>
            )}
            {(agents as any[])?.map((a: any) => (
              <div key={a.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] overflow-hidden">
                <button
                  onClick={() => setOpenStatusId(openStatusId === a.id ? null : a.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--muted)]"
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[a.status] ?? "bg-[var(--warning)]"}`} />
                  <span className="text-sm font-medium text-[var(--foreground)] truncate">{a.name}</span>
                  <span className="text-xs text-[var(--muted-foreground)] truncate">{a.transport} · {a.endpoint ?? "stdio"}</span>
                  <span className="ml-auto text-[var(--muted-foreground)]">
                    {openStatusId === a.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                </button>

                {a.status === "error" && (
                  <div className="px-3 pb-2 text-xs text-[var(--destructive)]">Unreachable — expand for details.</div>
                )}

                {openStatusId === a.id && (
                  <div className="border-t border-[var(--border)] px-3 py-3 space-y-2 text-xs">
                    {!statusDetail ? (
                      <div className="text-[var(--muted-foreground)]">Loading status…</div>
                    ) : (
                      <>
                        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
                          <span className="text-[var(--muted-foreground)]">Workspace</span>
                          <span className="text-[var(--foreground)] font-mono break-all">{statusDetail.registration.workspaceId}</span>
                          <span className="text-[var(--muted-foreground)]">Endpoint</span>
                          <span className="text-[var(--foreground)] font-mono break-all">{statusDetail.registration.endpoint ?? "— (stdio)"}</span>
                          <span className="text-[var(--muted-foreground)]">Transport</span>
                          <span className="text-[var(--foreground)]">{statusDetail.registration.transport}</span>
                          <span className="text-[var(--muted-foreground)]">Status</span>
                          <span className={statusDetail.providerReachable ? "text-[var(--success)]" : statusDetail.providerReachable === false ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]"}>
                            {statusDetail.providerReachable ? "reachable" : statusDetail.providerReachable === false ? "unreachable" : statusDetail.registration.status}
                          </span>
                          <span className="text-[var(--muted-foreground)]">Last heartbeat</span>
                          <span className="text-[var(--foreground)]">{statusDetail.registration.lastHeartbeatAt ? new Date(statusDetail.registration.lastHeartbeatAt).toLocaleString() : "—"}</span>
                        </div>
                        {statusDetail.capabilities && (
                          <details>
                            <summary className="cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Capabilities</summary>
                            <pre className="mt-1 rounded bg-[var(--muted)] p-2 font-mono text-[11px] text-[var(--muted-foreground)] overflow-auto max-h-32">{JSON.stringify(statusDetail.capabilities, null, 2)}</pre>
                          </details>
                        )}
                        {statusDetail.machineMetadata && (
                          <details>
                            <summary className="cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Machine</summary>
                            <pre className="mt-1 rounded bg-[var(--muted)] p-2 font-mono text-[11px] text-[var(--muted-foreground)] overflow-auto max-h-32">{JSON.stringify(statusDetail.machineMetadata, null, 2)}</pre>
                          </details>
                        )}
                      </>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => verify(a.id)}>
                        Re-check
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => setRemoveId(a.id)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={connect} className="space-y-3 border-t border-[var(--border)] pt-4">
            <div className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)]">CONNECT AN AGENT</div>

            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--muted-foreground)]">Workspace</Label>
              <Select value={workspaceId} onValueChange={setWorkspaceId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="agent-name" className="text-xs text-[var(--muted-foreground)]">Name</Label>
              <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. opencode on macbook" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--muted-foreground)]">Transport</Label>
              <Select value={transport} onValueChange={(v) => setTransport(v as any)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="network">network — opencode serve (HTTP)</SelectItem>
                  <SelectItem value="stdio">stdio — local shim (no endpoint)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {transport === "network" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="agent-endpoint" className="text-xs text-[var(--muted-foreground)]">Endpoint URL</Label>
                  <div className="flex gap-2">
                    <Input id="agent-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://localhost:4096" className="font-mono flex-1" />
                    <Button type="button" variant="outline" size="icon" disabled={!isValidUrl(endpoint)} title="Preview">
                      <RefreshCw className={`h-4 w-4 ${previewLoading ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                  {previewError ? (
                    <div className="rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">{previewError}</div>
                  ) : preview && (preview as any).providerReachable ? (
                    <div className="text-xs text-[var(--success)]">Reachable ✓</div>
                  ) : null}
                  <p className="text-[11px] text-[var(--muted-foreground)]">Run <code>opencode serve</code> locally, then paste the URL. For VPS, use <code>https://your-host:4096</code>.</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="agent-secret" className="text-xs text-[var(--muted-foreground)]">Auth secret <span className="font-normal opacity-60">(if required by your agent)</span></Label>
                  <div className="flex gap-2">
                    <Input id="agent-secret" type={showSecret ? "text" : "password"} value={authSecret} onChange={(e) => setAuthSecret(e.target.value)} placeholder="Bearer token" className="font-mono flex-1" autoComplete="off" />
                    <Button type="button" variant="outline" size="icon" onClick={() => setShowSecret((v) => !v)} title={showSecret ? "Hide" : "Show"}>
                      {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </>
            )}

            <Button type="submit" disabled={busy || !name.trim() || !workspaceId || (transport === "network" && !endpoint.trim())} className="w-full">
              <Plug className="h-4 w-4" />
              {busy ? "Verifying…" : "Connect"}
            </Button>
            <p className="text-xs text-[var(--muted-foreground)]">We probe <code>GET {"{endpoint}"}</code> then <code>POST {"{endpoint}/initialize"}</code> with Bearer auth. Stdio agents need a tiny local shim — see docs.</p>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove agent?</AlertDialogTitle>
            <AlertDialogDescription>Tasks and sessions for this agent will remain but the control channel will be closed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive/10 text-destructive hover:bg-destructive/20" onClick={() => { if (removeId) remove(removeId); setRemoveId(null); }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

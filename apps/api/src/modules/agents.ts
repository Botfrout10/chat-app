import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { and, asc, eq } from "drizzle-orm";
import { agentRegistration, workspaceMember, channel, channelMember } from "@chat/db/schema";
import { createAgentRegistrationSchema, updateAgentRegistrationSchema } from "@chat/shared/schemas";
import { enforceRate } from "../lib/rateLimit.js";
import { triggerAgentReply } from "../lib/agent.js";

const VERIFY_TIMEOUT_MS = 5_000;

function authHeaders(authSecret: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (authSecret) h["authorization"] = `Bearer ${authSecret}`;
  return h;
}

function sanitizeRegistration(row: any) {
  if (!row) return row;
  const { authSecret, ...rest } = row;
  return { ...rest, hasAuthSecret: !!authSecret };
}

function normalizeEndpoint(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

type VerifyResult = {
  ok: boolean;
  error?: string;
  capabilities?: unknown;
  machineMetadata?: unknown;
};

// Handshake: try to reach the agent's network endpoint.
// For now we probe GET <endpoint> and optionally POST <endpoint>/initialize
// with Bearer auth — agent-agnostic: we accept any 2xx and capture reported
// name/version/capabilities if present. Stdio transport is not verified over network.
function isHtmlResponse(text: string, contentType: string | null): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/html")) return true;
  const t = text.trim().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

function basicAuthHeaders(secret?: string | null): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (secret) h["authorization"] = `Basic ${Buffer.from(`opencode:${secret}`).toString("base64")}`;
  return h;
}

async function fetchWithVerifyFallback(url: string, secret?: string | null, init: RequestInit = {}): Promise<Response> {
  // try Basic (OpenCode) then Bearer (generic)
  const bearer: Record<string, string> = secret ? { authorization: `Bearer ${secret}` } : {};
  const basic = basicAuthHeaders(secret ?? null);
  const tryHeaders = secret ? [basic, bearer] : [basic];
  let lastRes: Response | null = null;
  for (const h of tryHeaders) {
    const merged = { ...init.headers, ...h } as Record<string, string>;
    const r = await fetch(url, { ...init, headers: merged, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) } as any);
    if (r.status !== 401 || !secret) return r;
    lastRes = r;
  }
  return lastRes!;
}

async function verifyAgent(endpoint: string, authSecret?: string | null, transport: string = "network"): Promise<VerifyResult> {
  if (transport === "stdio") {
    return { ok: true, capabilities: { transport: "stdio" }, machineMetadata: null };
  }
  const url = normalizeEndpoint(endpoint);
  // OpenCode `opencode serve` health & session probes; fallback to generic GET + /initialize
  const probes: Array<{ url: string; label: string }> = [
    { url: `${url}/global/health`, label: "OpenCode health" },
    { url: `${url}/session`, label: "OpenCode session list" },
    { url, label: "base" },
  ];
  for (const p of probes) {
    try {
      const res = await fetchWithVerifyFallback(p.url, authSecret ?? null, p.url === url ? {} : { headers: { accept: "application/json" } });
      const text = await res.text().catch(() => "");
      const ct = res.headers.get("content-type");
      if (!res.ok) {
        if (isHtmlResponse(text, ct)) {
          return {
            ok: false,
            error: `Agent endpoint returned HTML at ${p.url} (${res.status}). You hit the web UI, not the API. If using OpenCode, run \`opencode serve --port 4096\` (not \`opencode acp\` which is stdio-only) and use http://localhost:4096. Verify via curl -s ${url}/global/health . Spec at ${url}/doc.`,
          };
        }
        // try next probe on 404, otherwise surface error
        if (res.status === 404) continue;
        const hint = res.status === 401 ? " — Missing or invalid auth secret (try OPENCODE_SERVER_PASSWORD, user opencode)" : "";
        return { ok: false, error: `Agent responded ${res.status} ${res.statusText}${hint}${text ? ` ${text.slice(0, 200)}` : ""}`.slice(0, 500) };
      }
      // ok — parse capabilities
      let capabilities: unknown = null;
      let machineMetadata: unknown = null;
      try {
        const data = JSON.parse(text);
        capabilities = data?.capabilities ?? data?.agent ?? data ?? null;
        machineMetadata = data?.machine ?? data?.machineMetadata ?? null;
        if (!capabilities && data?.healthy) capabilities = { healthy: true, version: data.version };
        if (!capabilities && data?.name) capabilities = { name: data.name, version: data.version };
      } catch {
        // non-JSON but 200 — still reachable (e.g. /global/health returns {healthy:true})
      }
      return { ok: true, capabilities, machineMetadata };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("fetch") || msg.includes("ECONNREFUSED")) {
        // try next probe
        continue;
      }
      return { ok: false, error: `Agent unreachable (${p.label} ${p.url}): ${msg}` };
    }
  }
  // final fallback: POST /initialize (ACP generic)
  try {
    const headers: Record<string, string> = { "content-type": "application/json", ...basicAuthHeaders(authSecret ?? null) };
    const initRes = await fetch(`${url}/initialize`, {
      method: "POST",
      headers,
      body: JSON.stringify({ protocol: "acp", version: "0.1" }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const text = await initRes.text().catch(() => "");
    const ct = initRes.headers.get("content-type");
    if (initRes.ok) {
      let data: any = null;
      try { data = JSON.parse(text); } catch {}
      return { ok: true, capabilities: data?.capabilities ?? data ?? null, machineMetadata: data?.machine ?? null };
    }
    if (isHtmlResponse(text, ct)) {
      return { ok: false, error: `Agent returned HTML at ${url}/initialize — web UI, not API. Use opencode serve (http://localhost:4096).` };
    }
    return { ok: false, error: `Agent responded ${initRes.status} ${initRes.statusText}${text ? ` ${text.slice(0, 200)}` : ""}`.slice(0, 500) };
  } catch (e) {
    return { ok: false, error: `Agent unreachable: ${(e as Error).message}. Tip: for OpenCode run \`opencode serve --port 4096\` (not \`opencode acp\`), endpoint http://localhost:4096. Check ${url}/doc and ${url}/global/health.` };
  }
}

export async function registerAgentRoutes(app: FastifyInstance) {
  const db = () => (app as any).db;

  // list owned registrations
  app.get("/api/agents", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const rows = await db()
      .select()
      .from(agentRegistration)
      .where(eq(agentRegistration.ownerId, user.id))
      .orderBy(asc(agentRegistration.createdAt));
    return rows.map(sanitizeRegistration);
  });

  // create
  app.post("/api/agents", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "agent-verify", max: 10, windowMs: 60_000, subject: user.id }))) return;
    const parsed = createAgentRegistrationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const data = parsed.data;

    // workspace must exist and caller must be a member
    const dbi = db();
    const [wm] = await dbi
      .select()
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, data.workspaceId), eq(workspaceMember.userId, user.id)));
    if (!wm) return reply.code(403).send({ error: "Not a member of workspace" });

    const endpoint = data.endpoint ? normalizeEndpoint(data.endpoint) : null;
    const authSecret = data.authSecret?.trim() ? data.authSecret.trim() : null;
    const transport = data.transport ?? "network";

    // verify (handshake) — sets initial status
    let result: VerifyResult = { ok: true };
    if (transport === "network" && endpoint) {
      result = await verifyAgent(endpoint, authSecret, transport);
    }

    const [row] = await dbi
      .insert(agentRegistration)
      .values({
        id: ulid(),
        ownerId: user.id,
        workspaceId: data.workspaceId,
        name: data.name,
        transport,
        endpoint,
        authSecret,
        status: result.ok ? "online" : "error",
        capabilities: result.capabilities ?? null,
        machineMetadata: result.machineMetadata ?? null,
        lastHeartbeatAt: new Date(),
      })
      .returning();
    return sanitizeRegistration(row);
  });

  app.patch("/api/agents/:id", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "agent-verify", max: 10, windowMs: 60_000, subject: user.id }))) return;
    const { id } = req.params as any;
    const parsed = updateAgentRegistrationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const dbi = db();
    const [row] = await dbi.select().from(agentRegistration).where(and(eq(agentRegistration.id, id), eq(agentRegistration.ownerId, user.id)));
    if (!row) return reply.code(404).send({ error: "Agent not found" });

    // if workspaceId changes, verify membership
    if (parsed.data.workspaceId && parsed.data.workspaceId !== row.workspaceId) {
      const [wm] = await dbi
        .select()
        .from(workspaceMember)
        .where(and(eq(workspaceMember.workspaceId, parsed.data.workspaceId), eq(workspaceMember.userId, user.id)));
      if (!wm) return reply.code(403).send({ error: "Not a member of workspace" });
    }

    const nextTransport = parsed.data.transport ?? row.transport;
    // endpoint: if explicitly null clears it; if undefined keep existing
    const nextEndpoint =
      parsed.data.endpoint !== undefined
        ? (parsed.data.endpoint ? normalizeEndpoint(parsed.data.endpoint) : null)
        : row.endpoint;
    const incomingSecret = parsed.data.authSecret?.trim();
    const nextAuthSecret = incomingSecret ? incomingSecret : (row as any).authSecret;
    const nextName = parsed.data.name ?? row.name;
    const nextWorkspaceId = parsed.data.workspaceId ?? row.workspaceId;

    // validate transport/endpoint coherence after patch
    if (nextTransport === "network" && !nextEndpoint) {
      return reply.code(400).send({ error: "endpoint is required for network transport" });
    }

    const endpointChanged = nextEndpoint !== row.endpoint;
    const authChanged = !!incomingSecret;
    const transportChanged = nextTransport !== row.transport;

    let verify: VerifyResult | null = null;
    if (nextTransport === "network" && (endpointChanged || authChanged || transportChanged)) {
      verify = await verifyAgent(nextEndpoint!, nextAuthSecret, nextTransport);
    } else if (nextTransport === "stdio" && transportChanged) {
      verify = { ok: true, capabilities: { transport: "stdio" } };
    }

    const patch: any = {
      name: nextName,
      workspaceId: nextWorkspaceId,
      transport: nextTransport,
      endpoint: nextEndpoint,
      ...(incomingSecret ? { authSecret: incomingSecret } : {}),
      ...(verify
        ? {
            status: verify.ok ? "online" : "error",
            capabilities: verify.capabilities ?? row.capabilities,
            machineMetadata: verify.machineMetadata ?? row.machineMetadata,
            lastHeartbeatAt: new Date(),
          }
        : {}),
    };

    const [updated] = await dbi.update(agentRegistration).set(patch).where(eq(agentRegistration.id, id)).returning();
    return sanitizeRegistration(updated);
  });

  app.delete("/api/agents/:id", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const deleted = await db()
      .delete(agentRegistration)
      .where(and(eq(agentRegistration.id, id), eq(agentRegistration.ownerId, user.id)))
      .returning({ id: agentRegistration.id });
    if (!deleted.length) return reply.code(404).send({ error: "Agent not found" });
    return { ok: true };
  });

  // verify (handshake touch) — re-probe endpoint and update status/heartbeat
  app.post("/api/agents/:id/verify", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "agent-verify", max: 10, windowMs: 60_000, subject: user.id }))) return;
    const { id } = req.params as any;
    const dbi = db();
    const [row] = await dbi.select().from(agentRegistration).where(and(eq(agentRegistration.id, id), eq(agentRegistration.ownerId, user.id)));
    if (!row) return reply.code(404).send({ error: "Agent not found" });

    if (row.transport === "stdio" || !row.endpoint) {
      const [updated] = await dbi
        .update(agentRegistration)
        .set({ status: "online", lastHeartbeatAt: new Date() })
        .where(eq(agentRegistration.id, id))
        .returning();
      return sanitizeRegistration(updated);
    }

    const result = await verifyAgent(row.endpoint, (row as any).authSecret, row.transport);
    const [updated] = await dbi
      .update(agentRegistration)
      .set({
        status: result.ok ? "online" : "error",
        capabilities: result.ok ? (result.capabilities ?? row.capabilities) : row.capabilities,
        machineMetadata: result.ok ? (result.machineMetadata ?? row.machineMetadata) : row.machineMetadata,
        lastHeartbeatAt: new Date(),
      })
      .where(eq(agentRegistration.id, id))
      .returning();
    // surface verify error alongside row for UI
    const sanitized = sanitizeRegistration(updated);
    if (!result.ok) (sanitized as any).lastVerifyError = result.error;
    return sanitized;
  });

  // status detail: registration + live reachability snapshot
  app.get("/api/agents/:id/status", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const [row] = await db()
      .select()
      .from(agentRegistration)
      .where(and(eq(agentRegistration.id, id), eq(agentRegistration.ownerId, user.id)));
    if (!row) return reply.code(404).send({ error: "Agent not found" });

    let providerReachable: boolean | null = null;
    let liveCapabilities: unknown = null;
    let liveMachineMetadata: unknown = null;
    if (row.transport === "stdio" || !row.endpoint) {
      providerReachable = true;
    } else {
      const probe = await verifyAgent(row.endpoint, (row as any).authSecret, row.transport);
      providerReachable = probe.ok;
      if (probe.ok) {
        liveCapabilities = probe.capabilities;
        liveMachineMetadata = probe.machineMetadata;
      }
    }

    return {
      registration: sanitizeRegistration(row),
      providerReachable,
      capabilities: liveCapabilities ?? (row as any).capabilities,
      machineMetadata: liveMachineMetadata ?? (row as any).machineMetadata,
    };
  });

  // preview endpoint before creating (URL-first picker) — no DB write
  app.post("/api/agents/preview", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "agent-verify", max: 10, windowMs: 60_000, subject: user.id }))) return;
    const parsed = z
      .object({ endpoint: z.string().min(1).max(500), authSecret: z.string().max(500).optional(), transport: z.enum(["network", "stdio"]).optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const transport = parsed.data.transport ?? "network";
    if (transport === "stdio") return { providerReachable: true, capabilities: { transport: "stdio" }, endpoint: null };
    const endpoint = normalizeEndpoint(parsed.data.endpoint);
    try {
      new URL(endpoint);
    } catch {
      return reply.code(400).send({ error: "Invalid endpoint URL", providerReachable: false, capabilities: null, endpoint });
    }
    const authSecret = parsed.data.authSecret?.trim() || null;
    const result = await verifyAgent(endpoint, authSecret, transport);
    if (!result.ok) return reply.code(400).send({ error: result.error, providerReachable: false, capabilities: null, endpoint });
    return { providerReachable: true, capabilities: result.capabilities, machineMetadata: result.machineMetadata, endpoint };
  });

  // prompt an agent — creates a human message in the agent's workspace channel and streams the reply
  // Body: { channelId, content, parentId? } — channel must belong to the agent's workspace
  app.post("/api/agents/:id/prompt", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "agent-prompt", max: 20, windowMs: 60_000, subject: user.id }))) return;
    const { id } = req.params as any;
    const parsed = z.object({ channelId: z.string().min(1), content: z.string().min(1).max(4000), parentId: z.string().optional().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const dbi = db();
    const [agent] = await dbi.select().from(agentRegistration).where(and(eq(agentRegistration.id, id), eq(agentRegistration.ownerId, user.id)));
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const [ch] = await dbi.select().from(channel).where(eq(channel.id, parsed.data.channelId));
    if (!ch) return reply.code(404).send({ error: "Channel not found" });
    if (ch.workspaceId !== agent.workspaceId) return reply.code(400).send({ error: "Channel does not belong to agent's workspace" });
    const [cm] = await dbi.select().from(channelMember).where(and(eq(channelMember.channelId, ch.id), eq(channelMember.userId, user.id)));
    if (!cm && ch.type !== "public") return reply.code(403).send({ error: "Not a member of channel" });
    if (!cm && ch.type === "public") {
      const [wm] = await dbi.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, ch.workspaceId), eq(workspaceMember.userId, user.id)));
      if (!wm) return reply.code(403).send({ error: "Forbidden" });
      await dbi.insert(channelMember).values({ channelId: ch.id, userId: user.id }).onConflictDoNothing();
    }

    // create human prompt message
    const { ulid } = await import("ulid");
    const { message } = await import("@chat/db/schema");
    const promptId = ulid();
    const [promptMsg] = await dbi
      .insert(message)
      .values({ id: promptId, channelId: ch.id, senderId: user.id, parentId: parsed.data.parentId ?? null, content: parsed.data.content })
      .returning();
    const withSender = { ...promptMsg, sender: user, attachments: [], reactions: [] };
    await (app as any).redis.publish("chat:events", JSON.stringify({ type: "message:new", channelId: ch.id, message: withSender }));

    // fire-and-forget ACP streaming (publish agent:* then final message:new)
    void triggerAgentReply(app, { agent, channelId: ch.id, promptMessageId: promptId });

    return withSender;
  });

  // list channels for an agent's workspace (convenience for UI to pick a task thread)
  app.get("/api/agents/:id/channels", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const [agent] = await db().select().from(agentRegistration).where(and(eq(agentRegistration.id, id), eq(agentRegistration.ownerId, user.id)));
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const rows = await db().select().from(channel).where(eq(channel.workspaceId, agent.workspaceId));
    return rows;
  });

  // find-or-create DM with agent bot (like LLM DM) — enables normal chat in sidebar
  app.post("/api/agents/:id/dm", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const parsed = z.object({ workspaceId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const dbi = db();
    const [agent] = await dbi.select().from(agentRegistration).where(and(eq(agentRegistration.id, id), eq(agentRegistration.ownerId, user.id)));
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const [wm] = await dbi.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, parsed.data.workspaceId), eq(workspaceMember.userId, user.id)));
    if (!wm) return reply.code(403).send({ error: "Not a member of workspace" });
    const { findOrCreateAgentDm } = await import("../lib/agent.js");
    const ch = await findOrCreateAgentDm(app, agent, user.id, parsed.data.workspaceId);
    return { ...ch, agentId: agent.id, agentName: agent.name };
  });
}

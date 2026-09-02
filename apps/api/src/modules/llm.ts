import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ulid } from "ulid";
import { and, asc, eq } from "drizzle-orm";
import { llmConnection, workspaceMember } from "@chat/db/schema";
import { createLlmConnectionSchema, updateLlmConnectionSchema } from "@chat/shared/schemas";
import { slugify } from "@chat/shared/utils";
import { enforceRate } from "../lib/rateLimit.js";
import { findOrCreateLlmDm } from "../lib/llm.js";
import { decryptApiKey, encryptApiKey } from "../lib/crypto.js";

const VERIFY_TIMEOUT_MS = 5_000;

function authHeaders(apiKey: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (apiKey) h["authorization"] = `Bearer ${apiKey}`;
  return h;
}

function sanitizeConnection(row: any) {
  if (!row) return row;
  const { apiKeyEncrypted, ...rest } = row;
  return { ...rest, hasApiKey: !!apiKeyEncrypted };
}

// OpenAI-compatible providers expose the model list under <base>/models.
// Accept any host root and normalize to the versioned path (/v1) — LM Studio,
// Ollama and vLLM all serve there.
function normalizeBaseUrl(raw: string, provider: string = "openai-compatible"): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (provider === "anthropic") return trimmed; // Anthropic uses https://api.anthropic.com
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

type VerifyResult = {
  ok: boolean;
  error?: string;
  capabilities?: unknown;
  availableModels?: string[];
};

async function verifyConnection(baseUrl: string, modelId: string, apiKey?: string | null, provider: string = "openai-compatible"): Promise<VerifyResult> {
  if (provider === "anthropic") {
    if (!apiKey) return { ok: false, error: "Anthropic requires an API key" };
    // Anthropic has no /models; verify key via a lightweight HEAD to /v1/messages would fail without body.
    // Treat as ok if key looks plausible; surface modelId as-is.
    return { ok: true, capabilities: { provider: "anthropic" }, availableModels: [modelId] };
  }
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const hint = res.status === 401 ? " — Missing or invalid API key" : "";
      const short = detail ? ` ${detail.slice(0, 200)}` : "";
      return { ok: false, error: `Provider responded ${res.status} ${res.statusText}${hint}${short}`.slice(0, 500) };
    }
    const data = (await res.json()) as any;
    const models: any[] = Array.isArray(data?.data) ? data.data : [];
    const found = models.find((m) => m?.id === modelId);
    if (!found) {
      const names = models.map((m) => m?.id).filter(Boolean).slice(0, 10);
      return {
        ok: false,
        error: names.length
          ? `Model "${modelId}" not found. Available: ${names.join(", ")}`
          : `Provider returned no models`,
      };
    }
    // LM Studio may attach meta (context length etc.) — persist whatever it reports
    return { ok: true, capabilities: (found as any).meta ?? null, availableModels: models.map((m) => m.id) };
  } catch (e) {
    return { ok: false, error: `Provider unreachable: ${(e as Error).message}` };
  }
}

export async function registerLlmRoutes(app: FastifyInstance) {
  const db = () => (app as any).db;

  app.get("/api/llm/connections", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const rows = await db()
      .select()
      .from(llmConnection)
      .where(eq(llmConnection.ownerId, user.id))
      .orderBy(asc(llmConnection.createdAt));
    return rows.map(sanitizeConnection);
  });

  app.post("/api/llm/connections", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "llm-verify", max: 10, windowMs: 60_000, subject: user.id }))) return;
    const parsed = createLlmConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const data = parsed.data;

    let mentionName = data.mentionName ?? slugify(data.label);
    if (!mentionName) mentionName = ulid().toLowerCase().slice(0, 8);

    // mentionName is unique per owner — append a short suffix on conflict
    const existing = await db()
      .select({ mentionName: llmConnection.mentionName })
      .from(llmConnection)
      .where(eq(llmConnection.ownerId, user.id));
    const taken = new Set(existing.map((r: any) => r.mentionName));
    if (taken.has(mentionName)) mentionName = `${mentionName}-${ulid().slice(-4).toLowerCase()}`;

    const provider = (data as any).provider ?? "openai-compatible";
    const baseUrl = normalizeBaseUrl(data.baseUrl, provider);
    const apiKey = data.apiKey?.trim() ? data.apiKey.trim() : null;
    const result = await verifyConnection(baseUrl, data.modelId, apiKey, provider);
    const [row] = await db()
      .insert(llmConnection)
      .values({
        id: ulid(),
        ownerId: user.id,
        label: data.label,
        mentionName,
        provider,
        baseUrl,
        modelId: data.modelId,
        apiKeyEncrypted: apiKey ? encryptApiKey(apiKey) : null,
        status: result.ok ? "ok" : "error",
        lastError: result.error ?? null,
        capabilities: result.capabilities ?? null,
        lastCheckedAt: new Date(),
      })
      .returning();
    return sanitizeConnection(row);
  });

  app.patch("/api/llm/connections/:id", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "llm-verify", max: 10, windowMs: 60_000, subject: user.id }))) return;
    const { id } = req.params as any;
    const parsed = updateLlmConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const dbi = db();

    const [row] = await dbi.select().from(llmConnection).where(and(eq(llmConnection.id, id), eq(llmConnection.ownerId, user.id)));
    if (!row) return reply.code(404).send({ error: "Connection not found" });

    const providerNext = (parsed.data as any).provider ?? (row as any).provider ?? "openai-compatible";
    const next = {
      label: parsed.data.label ?? row.label,
      baseUrl: normalizeBaseUrl(parsed.data.baseUrl ?? row.baseUrl, providerNext),
      modelId: parsed.data.modelId ?? row.modelId,
      mentionName: parsed.data.mentionName ?? row.mentionName,
      provider: providerNext,
    };
    // apiKey update: if provided, re-encrypt; empty string means keep existing
    const incomingKey = parsed.data.apiKey?.trim();
    const existingKey = decryptApiKey((row as any).apiKeyEncrypted);
    const effectiveKey = incomingKey ? incomingKey : existingKey;
    const apiKeyPatch: any = {};
    if (incomingKey) apiKeyPatch.apiKeyEncrypted = encryptApiKey(incomingKey);

    // re-verify whenever provider coordinates or key change
    let verify: VerifyResult | null = null;
    if (next.baseUrl !== row.baseUrl || next.modelId !== row.modelId || next.provider !== (row as any).provider || incomingKey) {
      verify = await verifyConnection(next.baseUrl, next.modelId, effectiveKey, next.provider);
    }

    const [updated] = await dbi
      .update(llmConnection)
      .set({
        ...next,
        ...apiKeyPatch,
        ...(verify
          ? { status: verify.ok ? "ok" : "error", lastError: verify.error ?? null, capabilities: verify.capabilities ?? null, lastCheckedAt: new Date() }
          : {}),
      })
      .where(eq(llmConnection.id, id))
      .returning();
    return sanitizeConnection(updated);
  });

  app.delete("/api/llm/connections/:id", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const deleted = await db()
      .delete(llmConnection)
      .where(and(eq(llmConnection.id, id), eq(llmConnection.ownerId, user.id)))
      .returning({ id: llmConnection.id });
    if (!deleted.length) return reply.code(404).send({ error: "Connection not found" });
    return { ok: true };
  });

  // re-run provider validation (status page refresh)
  app.post("/api/llm/connections/:id/verify", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "llm-verify", max: 10, windowMs: 60_000, subject: user.id }))) return;
    const { id } = req.params as any;
    const dbi = db();
    const [row] = await dbi.select().from(llmConnection).where(and(eq(llmConnection.id, id), eq(llmConnection.ownerId, user.id)));
    if (!row) return reply.code(404).send({ error: "Connection not found" });

    const apiKey = decryptApiKey((row as any).apiKeyEncrypted);
    const provider = (row as any).provider ?? "openai-compatible";
    const result = await verifyConnection(row.baseUrl, row.modelId, apiKey, provider);
    const [updated] = await dbi
      .update(llmConnection)
      .set({
        status: result.ok ? "ok" : "error",
        lastError: result.error ?? null,
        capabilities: result.ok ? (result.capabilities ?? row.capabilities) : row.capabilities,
        lastCheckedAt: new Date(),
      })
      .where(eq(llmConnection.id, id))
      .returning();
    return sanitizeConnection(updated);
  });

  // find-or-create the owner's DM channel with this model (inside a workspace)
  app.post("/api/llm/connections/:id/dm", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const parsed = z.object({ workspaceId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const dbi = db();

    const [conn] = await dbi.select().from(llmConnection).where(and(eq(llmConnection.id, id), eq(llmConnection.ownerId, user.id)));
    if (!conn) return reply.code(404).send({ error: "Connection not found" });
    const [ws] = await dbi.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, parsed.data.workspaceId), eq(workspaceMember.userId, user.id)));
    if (!ws) return reply.code(403).send({ error: "Forbidden" });

    const ch = await findOrCreateLlmDm(app, conn, user.id, parsed.data.workspaceId);
    return { ...ch, llmConnectionId: conn.id, modelLabel: conn.label };
  });

  // preview models for a baseUrl before creating a connection (URL-first picker)
  app.post("/api/llm/preview", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "llm-verify", max: 10, windowMs: 60_000, subject: user.id }))) return;
    const parsed = z.object({ baseUrl: z.string().min(1).max(500), apiKey: z.string().max(500).optional(), provider: z.enum(["openai-compatible","anthropic"]).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const provider = (parsed.data as any).provider ?? "openai-compatible";
    const baseUrl = normalizeBaseUrl(parsed.data.baseUrl, provider);
    const apiKey = parsed.data.apiKey?.trim() || null;
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: authHeaders(apiKey),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (!res.ok) {
        const hint = res.status === 401 ? " — Missing or invalid API key" : "";
        return reply.code(400).send({ error: `Provider responded ${res.status} ${res.statusText}${hint}`, providerReachable: false, providerModels: null, baseUrl });
      }
      const data = (await res.json()) as any;
      const models: string[] = (Array.isArray(data?.data) ? data.data : []).map((m: any) => m?.id).filter(Boolean);
      return { providerReachable: true, providerModels: models, baseUrl };
    } catch (e) {
      return reply.code(400).send({ error: `Provider unreachable: ${(e as Error).message}`, providerReachable: false, providerModels: null, baseUrl });
    }
  });

  // status page detail: connection + live snapshot of what the provider offers
  app.get("/api/llm/connections/:id/status", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const [row] = await db()
      .select()
      .from(llmConnection)
      .where(and(eq(llmConnection.id, id), eq(llmConnection.ownerId, user.id)));
    if (!row) return reply.code(404).send({ error: "Connection not found" });

    let providerModels: string[] | null = null;
    const provider = (row as any).provider ?? "openai-compatible";
    const apiKey = decryptApiKey((row as any).apiKeyEncrypted);
    if (provider === "anthropic") {
      // Anthropic has no models listing; return the configured model as available if key present
      providerModels = apiKey ? [row.modelId] : null;
    } else {
      try {
        const res = await fetch(`${row.baseUrl}/models`, {
          headers: authHeaders(apiKey),
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          providerModels = (Array.isArray(data?.data) ? data.data : []).map((m: any) => m?.id).filter(Boolean);
        }
      } catch {
        // status page shows lastError instead; don't fail the endpoint on a dead provider
      }
    }

    return {
      connection: sanitizeConnection(row),
      providerReachable: providerModels !== null,
      providerModels,
    };
  });
}

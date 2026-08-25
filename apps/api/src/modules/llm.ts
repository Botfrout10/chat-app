import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { and, asc, eq } from "drizzle-orm";
import { llmConnection } from "@chat/db/schema";
import { createLlmConnectionSchema, updateLlmConnectionSchema } from "@chat/shared/schemas";
import { slugify } from "@chat/shared/utils";
import { enforceRate } from "../lib/rateLimit.js";

const VERIFY_TIMEOUT_MS = 5_000;

// OpenAI-compatible providers expose the model list under <base>/models.
// Accept any host root and normalize to the versioned path (/v1) — LM Studio,
// Ollama and vLLM all serve there.
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

type VerifyResult = {
  ok: boolean;
  error?: string;
  capabilities?: unknown;
  availableModels?: string[];
};

async function verifyConnection(baseUrl: string, modelId: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `Provider responded ${res.status} ${res.statusText}` };
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
    return { ok: true, capabilities: (found as any).meta ?? null };
  } catch (e) {
    return { ok: false, error: `Provider unreachable: ${(e as Error).message}` };
  }
}

export async function registerLlmRoutes(app: FastifyInstance) {
  const db = () => (app as any).db;

  app.get("/api/llm/connections", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    return db()
      .select()
      .from(llmConnection)
      .where(eq(llmConnection.ownerId, user.id))
      .orderBy(asc(llmConnection.createdAt));
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

    const baseUrl = normalizeBaseUrl(data.baseUrl);
    const result = await verifyConnection(baseUrl, data.modelId);
    const [row] = await db()
      .insert(llmConnection)
      .values({
        id: ulid(),
        ownerId: user.id,
        label: data.label,
        mentionName,
        baseUrl,
        modelId: data.modelId,
        status: result.ok ? "ok" : "error",
        lastError: result.error ?? null,
        capabilities: result.capabilities ?? null,
        lastCheckedAt: new Date(),
      })
      .returning();
    return row;
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

    const next = {
      label: parsed.data.label ?? row.label,
      baseUrl: normalizeBaseUrl(parsed.data.baseUrl ?? row.baseUrl),
      modelId: parsed.data.modelId ?? row.modelId,
      mentionName: parsed.data.mentionName ?? row.mentionName,
    };

    // re-verify whenever provider coordinates change
    let verify: VerifyResult | null = null;
    if (next.baseUrl !== row.baseUrl || next.modelId !== row.modelId) {
      verify = await verifyConnection(next.baseUrl, next.modelId);
    }

    const [updated] = await dbi
      .update(llmConnection)
      .set({
        ...next,
        ...(verify
          ? { status: verify.ok ? "ok" : "error", lastError: verify.error ?? null, capabilities: verify.capabilities ?? null, lastCheckedAt: new Date() }
          : {}),
      })
      .where(eq(llmConnection.id, id))
      .returning();
    return updated;
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

    const result = await verifyConnection(row.baseUrl, row.modelId);
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
    return updated;
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
    try {
      const res = await fetch(`${row.baseUrl}/models`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        providerModels = (Array.isArray(data?.data) ? data.data : []).map((m: any) => m?.id).filter(Boolean);
      }
    } catch {
      // status page shows lastError instead; don't fail the endpoint on a dead provider
    }

    return {
      connection: row,
      providerReachable: providerModels !== null,
      providerModels,
    };
  });
}

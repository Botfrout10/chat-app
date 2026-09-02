import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  agentRegistration,
  channel,
  channelMember,
  message,
  user as userTable,
} from "@chat/db/schema";
import { decryptApiKey } from "./crypto.js";

function getAgentSecret(agent: AgentRow): string | null {
  const enc = (agent as any).authSecretEncrypted ?? (agent as any).auth_secret_encrypted;
  if (enc) return decryptApiKey(enc);
  return (agent as any).authSecret ?? (agent as any).auth_secret ?? null;
}

const CONTEXT_MESSAGES = 20;
const GENERATION_TIMEOUT_MS = 120_000;
const BOT_EMAIL_DOMAIN = "agent.local";

export type AgentRow = typeof agentRegistration.$inferSelect;

export function agentBotEmailFor(agentId: string): string {
  return `agent+${agentId}@${BOT_EMAIL_DOMAIN}`;
}

export async function ensureAgentBotUser(app: FastifyInstance, agent: AgentRow) {
  const db = (app as any).db;
  const email = agentBotEmailFor(agent.id);
  const [existing] = await db.select().from(userTable).where(eq(userTable.email, email));
  if (existing) return existing;
  const [created] = await db
    .insert(userTable)
    .values({ id: ulid(), name: agent.name, email })
    .onConflictDoNothing()
    .returning();
  const bot = created ?? (await db.select().from(userTable).where(eq(userTable.email, email)))[0];
  return bot;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHtmlResponse(text: string, contentType: string | null): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/html")) return true;
  const t = text.trim().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

function buildAuthHeaders(secret?: string | null): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (!secret) return h;
  // OpenCode `opencode serve` uses HTTP Basic auth (user `opencode`), not Bearer.
  // Send Basic by default; caller also tries Bearer as fallback for generic agents.
  const basic = Buffer.from(`opencode:${secret}`).toString("base64");
  h["authorization"] = `Basic ${basic}`;
  return h;
}

function bearerHeaders(secret?: string | null): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (secret) h["authorization"] = `Bearer ${secret}`;
  return h;
}

async function fetchWithAuthFallback(
  url: string,
  secret: string | null | undefined,
  init: RequestInit,
  timeoutMs = 5_000,
): Promise<Response> {
  const basicHeaders = buildAuthHeaders(secret);
  const bearer = bearerHeaders(secret);
  // try Basic first (OpenCode), then Bearer (generic)
  const headersBasic = { ...init.headers, ...basicHeaders } as Record<string, string>;
  const headersBearer = { ...init.headers, ...bearer } as Record<string, string>;
  const hasSecret = !!secret;
  // we try Basic first only if secret exists; otherwise single attempt
  const attempts: Array<{ headers: Record<string, string>; label: string }> = hasSecret
    ? [{ headers: headersBasic, label: "Basic" }, { headers: headersBearer, label: "Bearer" }]
    : [{ headers: headersBasic, label: "none" }];

  let lastRes: Response | null = null;
  for (const a of attempts) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: a.headers,
        signal: AbortSignal.timeout(timeoutMs),
      } as any);
      // 401 -> try next auth style
      if (res.status === 401 && hasSecret && a.label === "Basic") {
        lastRes = res;
        continue;
      }
      return res;
    } catch (e) {
      if (a.label === "Basic" && hasSecret) continue;
      throw e;
    }
  }
  return lastRes!;
}

// ---------------------------------------------------------------------------
// OpenCode session cache: one OpenCode session per (agentId, channelId) persisted in DB
// ---------------------------------------------------------------------------

const sessionCache = new Map<string, string>(); // key `${agentId}:${channelId}` -> opencode sessionId (L1)
const sessionCreateInFlight = new Map<string, Promise<string>>();
const sessionRowCache = new Map<string, any>(); // key -> agentSession row

export async function getActiveAgentSessionRow(app: FastifyInstance, agentId: string, channelId: string) {
  const db = (app as any).db;
  const { agentSession } = await import("@chat/db/schema");
  const rows = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.agentId, agentId), eq(agentSession.channelId, channelId), eq(agentSession.status, "active" as any)))
    .orderBy(desc(agentSession.lastUsedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAgentSessionRow(
  app: FastifyInstance,
  agent: AgentRow,
  channelId: string,
  opts: { title?: string; systemPrompt?: string | null; parentSessionId?: string | null } = {},
  signal?: AbortSignal,
): Promise<any> {
  const db = (app as any).db;
  const { agentSession } = await import("@chat/db/schema");
  const endpoint = (agent.endpoint ?? "").replace(/\/+$/, "");
  if (!endpoint) throw new Error("Agent has no endpoint");
  const secret = getAgentSecret(agent);
  const title = opts.title ?? `pulse-${channelId.slice(0, 8)}-${ulid().slice(-4)}`;
  const body: any = { title };
  const sys = opts.systemPrompt ?? (agent as any).systemPrompt ?? null;
  if (sys) body.systemPrompt = sys;
  const url = `${endpoint}/session`;
  app.log.info(`[agent:${agent.name}] creating OpenCode session at ${url} for channel ${channelId} title=${title}`);
  const res = await fetchWithAuthFallback(url, secret, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(10_000),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const ct = res.headers.get("content-type");
    if (isHtmlResponse(text, ct)) {
      throw new Error(
        `Agent endpoint returned HTML (got web UI) — expected OpenCode API. URL ${url} returned ${res.status}. ` +
          `If you ran \`opencode acp\`, that is stdio-only. Run \`opencode serve --port 4096\` instead and use http://localhost:4096 as endpoint. Spec at ${endpoint}/doc.`,
      );
    }
    throw new Error(`Create session failed ${res.status} ${res.statusText}${text ? ` ${text.slice(0, 300)}` : ""}`);
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Create session returned non-JSON: ${text.slice(0, 300)}`);
  }
  const opencodeId = data?.id ?? data?.session?.id ?? data?.data?.id;
  if (!opencodeId) throw new Error(`Create session response missing id: ${text.slice(0, 300)}`);
  const row = await db
    .insert(agentSession)
    .values({
      id: ulid(),
      agentId: agent.id,
      channelId,
      opencodeSessionId: opencodeId,
      title,
      systemPrompt: sys,
      status: "active",
      parentSessionId: opts.parentSessionId ?? null,
    })
    .returning()
    .then((r: any) => r[0]);
  const key = `${agent.id}:${channelId}`;
  sessionCache.set(key, opencodeId);
  sessionRowCache.set(key, row);
  app.log.info(`[agent:${agent.name}] session ${opencodeId} (${row.id}) created for channel ${channelId}`);
  return row;
}

async function getOrCreateOpenCodeSession(
  app: FastifyInstance,
  agent: AgentRow,
  channelId: string,
  signal?: AbortSignal,
  opts: { sessionId?: string | null } = {},
): Promise<string> {
  // explicit sessionId override (for multi-session per channel)
  if (opts.sessionId) {
    const db = (app as any).db;
    const { agentSession } = await import("@chat/db/schema");
    const [row] = await db.select().from(agentSession).where(eq(agentSession.id, opts.sessionId));
    if (row?.opencodeSessionId) return row.opencodeSessionId;
    if (row && !row.opencodeSessionId) {
      // row exists but no remote id yet — create remote now
      const created = await createAgentSessionRow(app, agent, channelId, { title: row.title, systemPrompt: row.systemPrompt }, signal);
      return created.opencodeSessionId!;
    }
  }
  const key = `${agent.id}:${channelId}`;
  const cached = sessionCache.get(key);
  if (cached) return cached;
  const inflight = sessionCreateInFlight.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    // try DB active session first
    const existing = await getActiveAgentSessionRow(app, agent.id, channelId);
    if (existing?.opencodeSessionId) {
      // quick liveness probe (best-effort, fail-open)
      try {
        const endpoint = (agent.endpoint ?? "").replace(/\/+$/, "");
        const secret = getAgentSecret(agent);
        const probe = await fetchWithAuthFallback(`${endpoint}/session/${existing.opencodeSessionId}`, secret, { headers: { accept: "application/json" } }, 3000);
        if (probe.ok) {
          sessionCache.set(key, existing.opencodeSessionId);
          sessionRowCache.set(key, existing);
          // touch lastUsed
          const { agentSession } = await import("@chat/db/schema");
          await (app as any).db.update(agentSession).set({ lastUsedAt: new Date() }).where(eq(agentSession.id, existing.id));
          return existing.opencodeSessionId;
        }
        // stale (404) — archive and recreate
        if (probe.status === 404) {
          const { agentSession } = await import("@chat/db/schema");
          await (app as any).db.update(agentSession).set({ status: "archived" }).where(eq(agentSession.id, existing.id));
        } else {
          // other error — reuse stale but log
          sessionCache.set(key, existing.opencodeSessionId);
          return existing.opencodeSessionId;
        }
      } catch {
        // network fail — reuse stale
        sessionCache.set(key, existing.opencodeSessionId);
        return existing.opencodeSessionId;
      }
    }
    // create new persisted session
    const row = await createAgentSessionRow(app, agent, channelId, {}, signal);
    return row.opencodeSessionId!;
  })();
  sessionCreateInFlight.set(key, p);
  try {
    return await p;
  } finally {
    sessionCreateInFlight.delete(key);
  }
}

export function invalidateSessionCache(agentId: string, channelId: string) {
  sessionCache.delete(`${agentId}:${channelId}`);
  sessionRowCache.delete(`${agentId}:${channelId}`);
}

// ---------------------------------------------------------------------------
// Streaming via OpenCode: POST /session/:id/message (blocking) + SSE fallback
// ---------------------------------------------------------------------------

type AgentStreamEvent =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; tool: string; args?: unknown; id?: string }
  | { type: "tool_result"; tool: string; result: string }
  | { type: "plan"; text: string }
  | { type: "permission"; text: string; id?: string }
  | { type: "question"; text: string; id?: string }
  | { type: "subagent"; text: string; id?: string };

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Session-specific generator that uses the correct OpenCode API with true incremental polling
async function* streamViaOpenCodeSession(
  app: FastifyInstance,
  agent: AgentRow,
  channelId: string,
  latestUserContent: string,
  signal: AbortSignal,
  opts: { sessionId?: string | null } = {},
): AsyncGenerator<AgentStreamEvent> {
  const endpoint = (agent.endpoint ?? "").replace(/\/+$/, "");
  const secret = getAgentSecret(agent);
  if (!endpoint) throw new Error("Agent has no endpoint");

  const sessionId = await getOrCreateOpenCodeSession(app, agent, channelId, signal, opts);
  const promptAsyncUrl = `${endpoint}/session/${sessionId}/prompt_async`;
  const messageUrl = `${endpoint}/session/${sessionId}/message`;
  const listUrl = `${endpoint}/session/${sessionId}/message`;
  const body = { parts: [{ type: "text", text: latestUserContent }] };

  app.log.info(`[agent:${agent.name}] POST ${promptAsyncUrl} (polling for streaming)`);

  let promptAsyncOk = false;
  try {
    const asyncRes = await fetchWithAuthFallback(promptAsyncUrl, secret, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }, 10_000);
    if (asyncRes.ok || asyncRes.status === 204) {
      promptAsyncOk = true;
      await asyncRes.text().catch(() => "");
      app.log.info(`[agent:${agent.name}] prompt_async accepted ${asyncRes.status}, polling ${listUrl} for incremental deltas`);
    } else {
      const t = await asyncRes.text().catch(() => "");
      if (isHtmlResponse(t, asyncRes.headers.get("content-type"))) throw new Error(`prompt_async HTML ${asyncRes.status}`);
      app.log.warn(`[agent:${agent.name}] prompt_async ${asyncRes.status} ${t.slice(0,200)} — fallback to blocking`);
    }
  } catch (e) {
    app.log.warn(`[agent:${agent.name}] prompt_async failed: ${(e as Error).message} — fallback to blocking`);
  }

  if (promptAsyncOk) {
    // Incremental polling: GET /session/:id/message + GET /session/:id for status
    const pollIntervalMs = 500;
    const deadline = Date.now() + GENERATION_TIMEOUT_MS;
    let prevText = "";
    let prevReasoning = "";
    let prevToolCount = 0;
    let consecutiveNoChange = 0;
    const sessionStatusUrl = `${endpoint}/session/${sessionId}`;
    const sessionListStatusUrl = `${endpoint}/session/status`;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error("aborted");
      try {
        const res = await fetchWithAuthFallback(listUrl, secret, { headers: { accept: "application/json" } }, 5_000);
        const txt = await res.text().catch(() => "");
        if (!res.ok) {
          if (isHtmlResponse(txt, res.headers.get("content-type"))) throw new Error(`poll returned HTML ${res.status} — web UI`);
          app.log.warn(`[agent:${agent.name}] poll ${res.status} ${txt.slice(0,100)}`);
        } else {
          let arr: any[] = [];
          try {
            const j = JSON.parse(txt);
            arr = Array.isArray(j) ? j : j?.data ?? j?.messages ?? [];
          } catch {}
          const assistantEntries = arr.filter((e: any) => (e?.info?.role ?? e?.role) === "assistant" || (e?.info?.type ?? e?.type) === "assistant");
          const last = assistantEntries.length ? assistantEntries[assistantEntries.length - 1] : arr[arr.length - 1];
          const parts: any[] = last?.parts ?? last?.message?.parts ?? [];
          const textParts = parts.filter((p: any) => p.type === "text" && typeof p.text === "string").map((p: any) => p.text).join("");
          const reasoningParts = parts.filter((p: any) => (p.type === "reasoning" || p.type === "thinking") && typeof p.text === "string").map((p: any) => p.text).join("");
          const toolParts = parts.filter((p: any) => p.type === "tool" || p.type === "tool_call" || (p as any).tool);
          let didYield = false;
          if (textParts.length > prevText.length) {
            const delta = textParts.slice(prevText.length);
            prevText = textParts;
            didYield = true;
            for (let i = 0; i < delta.length; i += 40) yield { type: "delta", text: delta.slice(i, i + 40) };
            app.log.info(`[agent:${agent.name}] poll delta +${delta.length} chars total ${prevText.length}`);
          }
          if (reasoningParts.length > prevReasoning.length) {
            const delta = reasoningParts.slice(prevReasoning.length);
            prevReasoning = reasoningParts;
            didYield = true;
            yield { type: "thinking", text: delta };
            app.log.info(`[agent:${agent.name}] poll thinking +${delta.length} chars`);
          }
          if (toolParts.length > prevToolCount) {
            for (let i = prevToolCount; i < toolParts.length; i++) {
              const p = toolParts[i];
              const tool = (p as any).tool ?? (p as any).name ?? (p as any).id ?? "tool";
              yield { type: "tool_call", tool: String(tool), args: (p as any).args ?? (p as any).input ?? (p as any).arguments, id: (p as any).id };
              if ((p as any).output) yield { type: "tool_result", tool: String(tool), result: String((p as any).output).slice(0, 2000) };
            }
            prevToolCount = toolParts.length;
            didYield = true;
            app.log.info(`[agent:${agent.name}] poll tool calls ${toolParts.length}`);
          }
          // permission / question / plan / subagent parts (opencode ACP)
          const permParts = parts.filter((p: any) => p.type === "permission" && typeof (p.text ?? p.message) === "string");
          if (permParts.length) {
            const lastPerm = permParts[permParts.length - 1];
            const permText = String(lastPerm.text ?? lastPerm.message ?? "");
            if (permText && !prevText.includes(permText.slice(0, 20))) {
              yield { type: "permission", text: permText, id: lastPerm.id ?? lastPerm.permissionId };
              didYield = true;
            }
          }
          const questionParts = parts.filter((p: any) => (p.type === "question" || p.type === "ask") && typeof (p.text ?? p.question) === "string");
          if (questionParts.length) {
            const lastQ = questionParts[questionParts.length - 1];
            const qText = String(lastQ.text ?? lastQ.question ?? lastQ.message ?? "");
            if (qText) {
              yield { type: "question", text: qText, id: lastQ.id ?? lastQ.questionId };
              didYield = true;
            }
          }
          const planParts = parts.filter((p: any) => p.type === "plan" && typeof p.text === "string");
          if (planParts.length) {
            const lastPlan = planParts[planParts.length - 1];
            if (lastPlan.text) { yield { type: "plan", text: String(lastPlan.text) }; didYield = true; }
          }
          const subParts = parts.filter((p: any) => p.type === "subagent" && typeof p.text === "string");
          if (subParts.length) {
            for (const sp of subParts) { yield { type: "subagent", text: String(sp.text), id: sp.id }; didYield = true; }
          }
          if (didYield) consecutiveNoChange = 0;
          else consecutiveNoChange++;

          // Check session idle via dedicated endpoint (more reliable than message status)
          let sessionIdle = false;
          try {
            const sRes = await fetchWithAuthFallback(sessionStatusUrl, secret, { headers: { accept: "application/json" } }, 3_000);
            if (sRes.ok) {
              const sTxt = await sRes.text().catch(() => "");
              const sData = JSON.parse(sTxt);
              const s = sData?.session ?? sData ?? {};
              const status = (s.status ?? s.state ?? "").toString().toLowerCase();
              if (status === "idle" || status === "completed" || status === "finished" || status === "done") sessionIdle = true;
              // also check global status map fallback
            }
          } catch {}
          if (!sessionIdle) {
            try {
              const gRes = await fetchWithAuthFallback(sessionListStatusUrl, secret, { headers: { accept: "application/json" } }, 3_000);
              if (gRes.ok) {
                const gTxt = await gRes.text().catch(() => "");
                const gData = JSON.parse(gTxt);
                const entry = gData?.[sessionId] ?? gData?.data?.[sessionId];
                const st = (entry?.status ?? entry?.state ?? "").toString().toLowerCase();
                if (st === "idle" || st === "completed" || st === "finished") sessionIdle = true;
              }
            } catch {}
          }
          const msgStatus = (last?.info?.status ?? last?.status ?? "").toString().toLowerCase();
          const isMsgDone = ["completed", "finished", "idle", "done"].includes(msgStatus);
          if ((sessionIdle || isMsgDone) && (prevText.length > 0 || prevToolCount > 0)) {
            // ensure we fetched final text after idle — one more poll to confirm no new delta
            if (consecutiveNoChange >= 2) {
              app.log.info(`[agent:${agent.name}] polling detected idle/completed (sessionIdle=${sessionIdle} msgStatus=${msgStatus}) with ${prevText.length} chars, done`);
              break;
            }
          }
          // Only consider stalled if session is idle; while busy, keep polling even without new text (tools running)
          if (!sessionIdle && prevText.length === 0 && toolParts.length === 0) {
            // still generating but no output yet (e.g. running docker ps) — keep polling
            consecutiveNoChange = 0;
          }
          if (sessionIdle && consecutiveNoChange >= 6) {
            app.log.info(`[agent:${agent.name}] polling idle + stable 3s, ending with ${prevText.length} chars`);
            break;
          }
        }
      } catch (e) {
        if ((e as Error).message.includes("aborted")) throw e;
        app.log.warn(`[agent:${agent.name}] poll error: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      if (signal.aborted) break;
    }
    if (prevText || prevReasoning || prevToolCount > 0) {
      // final drain: one more fetch to capture any trailing delta that arrived between last poll and idle
      try {
        const finalRes = await fetchWithAuthFallback(listUrl, secret, { headers: { accept: "application/json" } }, 5_000);
        const finalTxt = await finalRes.text().catch(() => "");
        if (finalRes.ok) {
          const fj = JSON.parse(finalTxt);
          const farr: any[] = Array.isArray(fj) ? fj : fj?.data ?? fj?.messages ?? [];
          const fEntries = farr.filter((e: any) => (e?.info?.role ?? e?.role) === "assistant" || (e?.info?.type ?? e?.type) === "assistant");
          const flast = fEntries.length ? fEntries[fEntries.length - 1] : farr[farr.length - 1];
          const fparts: any[] = flast?.parts ?? flast?.message?.parts ?? [];
          const ftext = fparts.filter((p: any) => p.type === "text" && typeof p.text === "string").map((p: any) => p.text).join("");
          if (ftext.length > prevText.length) {
            const delta = ftext.slice(prevText.length);
            for (let i = 0; i < delta.length; i += 40) yield { type: "delta", text: delta.slice(i, i + 40) };
            prevText = ftext;
          }
        }
      } catch {}
      if (prevText.trim() || prevToolCount > 0) return;
    }
    app.log.info(`[agent:${agent.name}] polling yielded no text, falling back to blocking POST ${messageUrl}`);
  }

  // Blocking fallback: POST /session/:id/message waits for full response
  const res = await fetchWithAuthFallback(messageUrl, secret, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }, GENERATION_TIMEOUT_MS);
  const text = await res.text().catch(() => "");
  const ct = res.headers.get("content-type");
  if (!res.ok) {
    if (isHtmlResponse(text, ct)) {
      throw new Error(
        `Agent endpoint returned HTML at ${messageUrl} (${res.status}). You are hitting the web UI, not the API. Use \`opencode serve\` (not \`opencode acp\`) and set endpoint to http://localhost:4096. Verify via curl -s http://localhost:4096/global/health.`,
      );
    }
    throw new Error(`Agent message failed ${res.status} ${res.statusText}${text ? ` ${text.slice(0, 500)}` : ""}`);
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    yield { type: "delta", text };
    return;
  }
  const parts: any[] = data?.parts ?? data?.message?.parts ?? data?.data?.parts ?? [];
  let full = "";
  for (const p of parts) {
    if (p.type === "text" && typeof p.text === "string") full += p.text;
    else if (p.type === "tool" && p.tool) {
      yield { type: "tool_call", tool: p.tool, args: p.args ?? p.input };
      if (p.output) yield { type: "tool_result", tool: p.tool, result: String(p.output).slice(0, 2000) };
    } else if (p.type === "reasoning" && p.text) yield { type: "thinking", text: p.text };
  }
  if (full) {
    for (let i = 0; i < full.length; i += 40) yield { type: "delta", text: full.slice(i, i + 40) };
  } else if (!parts.length) {
    const fallback = data?.info?.content ?? data?.content ?? "";
    if (fallback) yield { type: "delta", text: String(fallback) };
  }
}

// Generic fallback for non-OpenCode agents (OpenAI-style)
async function* streamGeneric(
  agent: AgentRow,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream, application/x-ndjson, application/json" };
  const secretGeneric = getAgentSecret(agent);
  if (secretGeneric) headers["authorization"] = `Bearer ${secretGeneric}`;
  const endpoint = (agent.endpoint ?? "").replace(/\/+$/, "");
  const candidates: Array<{ url: string; body: unknown }> = [
    { url: `${endpoint}/v1/chat/completions`, body: { model: "agent", messages, stream: true } },
    { url: `${endpoint}/chat/completions`, body: { model: "agent", messages, stream: true } },
  ];
  let res: Response | null = null;
  let lastError: string | null = null;
  for (const c of candidates) {
    try {
      const r = await fetch(c.url, { method: "POST", headers, body: JSON.stringify(c.body), signal });
      if (r.ok && r.body) {
        res = r;
        break;
      }
      const detail = await r.text().catch(() => "");
      lastError = `${r.status} ${r.statusText}${detail ? ` ${detail.slice(0, 200)}` : ""}`;
      if (r.status === 404) continue;
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  if (!res || !res.body) throw new Error(lastError ? `Agent endpoint unreachable: ${lastError}` : "Agent endpoint unreachable");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const raw = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!raw) continue;
      const line = raw.startsWith("data:") ? raw.slice(5).trim() : raw;
      if (!line || line === "[DONE]") continue;
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        yield { type: "delta", text: raw + "\n" };
        continue;
      }
      const delta = evt?.choices?.[0]?.delta;
      if (delta) {
        const thinking = delta.reasoning_content ?? delta.reasoning;
        if (typeof thinking === "string" && thinking) yield { type: "thinking", text: thinking };
        if (typeof delta.content === "string" && delta.content) yield { type: "delta", text: delta.content };
      } else if (typeof evt.content === "string" && evt.content) yield { type: "delta", text: evt.content };
      else if (typeof evt.text === "string" && evt.text) yield { type: "delta", text: evt.text };
    }
  }
}

async function* streamAgent(
  app: FastifyInstance,
  agent: AgentRow,
  channelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  opts: { sessionId?: string | null } = {},
): AsyncGenerator<AgentStreamEvent> {
  const endpoint = (agent.endpoint ?? "").replace(/\/+$/, "");
  const flavor = (agent as any).transportFlavor ?? "opencode-http";
  const isLikelyOpenCode = flavor === "opencode-http" || endpoint.includes("4096") || endpoint.includes("opencode");
  if (isLikelyOpenCode) {
    const latest = messages[messages.length - 1]?.content ?? "";
    // strip "user: " prefix if present
    const clean = latest.replace(/^[^:]+:\s*/, "");
    yield* streamViaOpenCodeSession(app, agent, channelId, clean, signal, { sessionId: opts.sessionId });
    return;
  }
  // fallback to generic ACP
  yield* streamGeneric(agent, messages, signal);
}

// ---------------------------------------------------------------------------
// Reply orchestration — one generation per agent, abort on prompt edit/delete
// ---------------------------------------------------------------------------

const generating = new Set<string>();
const activeByPrompt = new Map<string, Map<string, AbortController>>();

export function abortAgentGenerationForMessage(promptMessageId: string): boolean {
  const controllers = activeByPrompt.get(promptMessageId);
  if (!controllers?.size) return false;
  for (const c of controllers.values()) c.abort();
  activeByPrompt.delete(promptMessageId);
  return true;
}

function trackPrompt(promptMessageId: string, agentId: string, controller: AbortController) {
  let m = activeByPrompt.get(promptMessageId);
  if (!m) {
    m = new Map();
    activeByPrompt.set(promptMessageId, m);
  }
  m.set(agentId, controller);
}

function untrackPrompt(promptMessageId: string, agentId: string, controller: AbortController) {
  const m = activeByPrompt.get(promptMessageId);
  if (!m) return;
  if (m.get(agentId) === controller) m.delete(agentId);
  if (m.size === 0) activeByPrompt.delete(promptMessageId);
}

async function checkRateLimit(redis: any, ownerId: string): Promise<boolean> {
  try {
    const { registerRateLimitCommands } = await import("./rateLimit.js");
    registerRateLimitCommands(redis);
    const key = `rl:agent-complete:${ownerId}`;
    const member = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [allowedRaw] = (await redis.slidingWindow(key, Date.now(), 60_000, 20, member)) as number[];
    return Number(allowedRaw) === 1;
  } catch {
    return true;
  }
}

async function assembleContext(db: any, channelId: string, agentName: string, botId?: string): Promise<ChatMessage[]> {
  const rows = await db
    .select({ senderId: message.senderId, content: message.content })
    .from(message)
    .where(and(eq(message.channelId, channelId), isNull(message.deletedAt)))
    .orderBy(desc(message.id))
    .limit(CONTEXT_MESSAGES);
  const history = rows.reverse();
  const ids: string[] = [...new Set<string>(history.map((r: any) => r.senderId))];
  const senders = ids.length ? await db.select({ id: userTable.id, name: userTable.name }).from(userTable).where(inArray(userTable.id, ids)) : [];
  const names = new Map(senders.map((u: any) => [u.id, u.name]));
  const chats: ChatMessage[] = [
    { role: "system", content: `You are "${agentName}", an AI agent connected via ACP. Reply concisely. Messages are prefixed with author name when known.` },
    ...history.map((r: any) => ({
      role: botId && r.senderId === botId ? ("assistant" as const) : ("user" as const),
      content: `${names.get(r.senderId) ?? "user"}: ${r.content}`,
    })),
  ];
  return chats;
}

function queueKey(agentId: string, channelId: string, sessionId?: string | null) {
  return `${agentId}:${sessionId ?? channelId}`;
}

export async function triggerAgentReply(
  app: FastifyInstance,
  args: { agent: AgentRow; channelId: string; promptMessageId?: string; sessionId?: string | null },
): Promise<boolean> {
  const db = (app as any).db;
  const redis = (app as any).redis;
  const qKey = queueKey(args.agent.id, args.channelId, args.sessionId ?? null);

  if (generating.has(qKey)) {
    // queue-while-streaming via BullMQ
    try {
      const { getAgentQueue } = await import("./queue.js");
      const queue = getAgentQueue();
      const waiting = await queue.getWaitingCount().catch(() => 0);
      await queue.add("prompt", { agentId: args.agent.id, channelId: args.channelId, sessionId: args.sessionId ?? null, promptMessageId: args.promptMessageId }, { jobId: args.promptMessageId ?? undefined });
      await redis.publish("chat:events", JSON.stringify({ type: "agent:ack", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, queued: true, queuePosition: waiting + 1, promptMessageId: args.promptMessageId }));
      await redis.publish("chat:events", JSON.stringify({ type: "agent:queue", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, depth: waiting + 1 }));
      app.log.info(`[agent:${args.agent.name}] queued prompt ${args.promptMessageId} (queue depth ${waiting + 1})`);
      return true;
    } catch (e) {
      app.log.error(`[agent:${args.agent.name}] queue failed: ${(e as Error).message}`);
      return false;
    }
  }
  return triggerAgentReplyInternal(app, args);
}

export async function triggerAgentReplyInternal(
  app: FastifyInstance,
  args: { agent: AgentRow; channelId: string; promptMessageId?: string; sessionId?: string | null },
): Promise<boolean> {
  const db = (app as any).db;
  const redis = (app as any).redis;
  const qKey = queueKey(args.agent.id, args.channelId, args.sessionId ?? null);

  if (generating.has(qKey)) {
    app.log.info(`[agent:${args.agent.name}] skip (internal) — already generating ${qKey}`);
    return false;
  }
  const ownerId = (args.agent as any).ownerId as string;
  if (ownerId && !(await checkRateLimit(redis, ownerId))) {
    await redis.publish("chat:events", JSON.stringify({ type: "agent:error", channelId: args.channelId, agentId: args.agent.id, error: "Rate limit: too many agent prompts, try again shortly." }));
    return false;
  }
  generating.add(qKey);

  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(GENERATION_TIMEOUT_MS)]);
  if (args.promptMessageId) trackPrompt(args.promptMessageId, args.agent.id, controller);

  app.log.info(`[agent:${args.agent.name}] trigger reply in channel ${args.channelId}${args.promptMessageId ? ` for prompt ${args.promptMessageId}` : ""}${args.sessionId ? ` session ${args.sessionId}` : ""}`);
  // immediate ack feedback
  await redis.publish("chat:events", JSON.stringify({ type: "agent:ack", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, promptMessageId: args.promptMessageId, queued: false }));
  await redis.publish("chat:events", JSON.stringify({ type: "agent:typing", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, isTyping: true }));

  try {
    const bot = await ensureAgentBotUser(app, args.agent);
    const messages = await assembleContext(db, args.channelId, args.agent.name, bot.id);
    for (const m of messages) {
      if (m.content.startsWith(`${bot.name}: `)) m.content = m.content.slice(`${bot.name}: `.length);
    }

    let full = "";
    let reasoning = "";
    const toolCalls: Array<{ tool: string; args?: unknown }> = [];
    for await (const evt of streamAgent(app, args.agent, args.channelId, messages, signal, { sessionId: args.sessionId ?? null })) {
      if (evt.type === "thinking") {
        reasoning += evt.text;
        await redis.publish("chat:events", JSON.stringify({ type: "agent:thinking", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, delta: evt.text }));
      } else if (evt.type === "delta") {
        full += evt.text;
        await redis.publish("chat:events", JSON.stringify({ type: "agent:delta", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, delta: evt.text }));
      } else if (evt.type === "tool_call") {
        toolCalls.push({ tool: evt.tool, args: evt.args });
        await redis.publish("chat:events", JSON.stringify({ type: "agent:tool", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, tool: evt.tool, args: evt.args, id: evt.id }));
      } else if (evt.type === "tool_result") {
        await redis.publish("chat:events", JSON.stringify({ type: "agent:tool_result", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, tool: evt.tool, result: evt.result }));
      } else if (evt.type === "plan") {
        await redis.publish("chat:events", JSON.stringify({ type: "agent:plan", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, text: evt.text }));
      } else if (evt.type === "permission") {
        await redis.publish("chat:events", JSON.stringify({ type: "agent:permission", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, text: evt.text, id: evt.id }));
      } else if (evt.type === "question") {
        await redis.publish("chat:events", JSON.stringify({ type: "agent:question", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, text: evt.text, id: evt.id }));
      } else if (evt.type === "subagent") {
        await redis.publish("chat:events", JSON.stringify({ type: "agent:subagent", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, text: evt.text, id: evt.id }));
      }
    }
    if (!full.trim() && toolCalls.length === 0) throw new Error("Agent returned an empty response");

    const id = ulid();
    const [msg] = await db
      .insert(message)
      .values({ id, channelId: args.channelId, senderId: bot.id, content: full.trim() || `[tool: ${toolCalls.map((t) => t.tool).join(", ")}]`, reasoning: reasoning.trim() || null })
      .returning();
    const withSender = { ...msg, sender: bot, attachments: [], reactions: [], agentId: args.agent.id, sessionId: args.sessionId ?? null };
    app.log.info(`[agent:${args.agent.name}] reply ${id} with ${full.length} chars, ${toolCalls.length} tool calls`);
    await redis.publish("chat:events", JSON.stringify({ type: "message:new", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, message: withSender }));
    await db.update(agentRegistration).set({ status: "online", lastHeartbeatAt: new Date() }).where(eq(agentRegistration.id, args.agent.id));
    // touch session lastUsed
    if (args.sessionId) {
      const { agentSession } = await import("@chat/db/schema");
      await db.update(agentSession).set({ lastUsedAt: new Date() }).where(eq(agentSession.id, args.sessionId));
    } else {
      // touch default session for channel
      const row = await getActiveAgentSessionRow(app, args.agent.id, args.channelId);
      if (row) {
        const { agentSession } = await import("@chat/db/schema");
        await db.update(agentSession).set({ lastUsedAt: new Date() }).where(eq(agentSession.id, row.id));
      }
    }
    return true;
  } catch (e) {
    const cancelled = controller.signal.aborted;
    app.log.error(`agent generation ${cancelled ? "cancelled" : "failed"} (${args.agent.name}): ${(e as Error).message}`);
    if (!cancelled) {
      await redis.publish("chat:events", JSON.stringify({ type: "agent:error", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, error: (e as Error).message }));
      await db.update(agentRegistration).set({ status: "error" }).where(eq(agentRegistration.id, args.agent.id));
    }
    return false;
  } finally {
    generating.delete(qKey);
    if (args.promptMessageId) untrackPrompt(args.promptMessageId, args.agent.id, controller);
    await redis.publish("chat:events", JSON.stringify({ type: "agent:typing", channelId: args.channelId, agentId: args.agent.id, sessionId: args.sessionId ?? null, isTyping: false }));
    // if queued jobs waiting for this session, drain next
    try {
      const { getAgentQueue } = await import("./queue.js");
      const q = getAgentQueue();
      const waiting = await q.getJobs(["waiting"], 0, 0, true);
      const next = waiting.find((j: any) => {
        const d = j.data as any;
        return d.agentId === args.agent.id && (d.sessionId ?? null) === (args.sessionId ?? null) && (d.channelId === args.channelId);
      });
      if (next) {
        // let worker handle it, but if no worker, trigger directly
        // worker will pick it up; no need to manually trigger
      }
    } catch {}
  }
}

// helper to trigger from a channel message: DM auto-reply + @name mention
export async function maybeTriggerAgent(
  app: FastifyInstance,
  args: { channel: typeof channel.$inferSelect; senderId: string; content: string; messageId: string },
) {
  try {
    const db = (app as any).db;
    const agents: AgentRow[] = await db.select().from(agentRegistration).where(eq(agentRegistration.ownerId, args.senderId));
    if (!agents.length) return;
    const byBot = new Map<string, AgentRow>();
    for (const a of agents) {
      const bot = await ensureAgentBotUser(app, a);
      byBot.set(bot.id, a);
    }
    if (args.channel.type === "dm") {
      const members = await db.select({ userId: channelMember.userId }).from(channelMember).where(eq(channelMember.channelId, args.channel.id));
      const peer = members.find((m: any) => m.userId !== args.senderId);
      if (peer && byBot.has(peer.userId)) {
        void triggerAgentReply(app, { agent: byBot.get(peer.userId)!, channelId: args.channel.id, promptMessageId: args.messageId });
        return;
      }
    }
    const tokens = new Set((args.content.match(/@([\p{L}\p{N}_.-]+)/gu) ?? []).map((t) => t.slice(1).toLowerCase()));
    if (!tokens.size) return;
    const { slugify } = await import("@chat/shared/utils");
    for (const agent of agents) {
      const slug = slugify(agent.name).toLowerCase();
      const raw = agent.name.toLowerCase();
      if ((slug && tokens.has(slug)) || (raw && tokens.has(raw)) || tokens.has(agent.name.toLowerCase().replace(/\s+/g, "-"))) {
        void triggerAgentReply(app, { agent, channelId: args.channel.id, promptMessageId: args.messageId });
      }
    }
  } catch (e) {
    (app as any).log?.error?.(`maybeTriggerAgent failed: ${(e as Error).message}`);
  }
}

export async function findOrCreateAgentDm(app: FastifyInstance, agent: AgentRow, userId: string, workspaceId: string) {
  const db = (app as any).db;
  const bot = await ensureAgentBotUser(app, agent);
  const { createHash } = await import("node:crypto");
  const pair = [userId, bot.id].sort().join(":");
  const name = `dm-${createHash("sha1").update(pair).digest("hex").slice(0, 12)}`;
  const [existing] = await db.select().from(channel).where(and(eq(channel.workspaceId, workspaceId), eq(channel.type, "dm"), eq(channel.name, name)));
  if (existing) return { ...existing, created: false };
  const chId = ulid();
  const [ch] = await db.insert(channel).values({ id: chId, workspaceId, name, type: "dm", createdBy: userId }).returning();
  await db.insert(channelMember).values([{ channelId: chId, userId }, { channelId: chId, userId: bot.id }]).onConflictDoNothing();
  return { ...ch, created: true };
}

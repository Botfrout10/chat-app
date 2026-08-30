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

const CONTEXT_MESSAGES = 20;
const GENERATION_TIMEOUT_MS = 120_000;
const BOT_EMAIL_DOMAIN = "agent.local";

export type AgentRow = typeof agentRegistration.$inferSelect;

// ---------------------------------------------------------------------------
// Bot user: each agent gets a synthetic user so replies are ordinary message rows
// ---------------------------------------------------------------------------

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
// ACP-ish streaming: try agent endpoint as SSE/NDJSON, fall back to OpenAI-style
// ---------------------------------------------------------------------------

type AgentStreamEvent =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; tool: string; args?: unknown; id?: string }
  | { type: "tool_result"; tool: string; result: string }
  | { type: "plan"; text: string }
  | { type: "permission"; text: string; id?: string };

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function* streamAgent(
  agent: AgentRow,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream, application/x-ndjson, application/json" };
  if ((agent as any).authSecret) headers["authorization"] = `Bearer ${(agent as any).authSecret}`;
  const endpoint = (agent.endpoint ?? "").replace(/\/+$/, "");
  if (!endpoint) throw new Error("Agent has no endpoint");

  // Candidate paths — agent-agnostic: try ACP session prompt first, then generic /prompt, then OpenAI fallback
  const candidates: Array<{ url: string; body: unknown }> = [
    { url: `${endpoint}/sessions/prompt`, body: { messages, stream: true } },
    { url: `${endpoint}/prompt`, body: { messages, stream: true } },
    { url: `${endpoint}/v1/chat/completions`, body: { model: "agent", messages, stream: true } },
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
      // 404 → try next candidate; other errors still try next but remember
      if (r.status === 404) continue;
      // for non-404 but still error, break with last candidate failing — we want to surface
      // but still try alternatives for interop
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  if (!res || !res.body) {
    throw new Error(lastError ? `Agent endpoint unreachable: ${lastError}` : "Agent endpoint unreachable");
  }

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
      // strip SSE prefix if present
      const line = raw.startsWith("data:") ? raw.slice(5).trim() : raw;
      if (!line || line === "[DONE]") continue;
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        // plain text delta fallback
        yield { type: "delta", text: raw + "\n" };
        continue;
      }
      // OpenAI-style delta
      const delta = evt?.choices?.[0]?.delta;
      if (delta) {
        const thinking = delta.reasoning_content ?? delta.reasoning;
        if (typeof thinking === "string" && thinking) yield { type: "thinking", text: thinking };
        if (typeof delta.content === "string" && delta.content) yield { type: "delta", text: delta.content };
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) yield { type: "tool_call", tool: tc.function?.name ?? tc.type ?? "tool", args: tc.function?.arguments, id: tc.id };
        }
        continue;
      }
      // ACP-ish typed events
      const t = evt.type ?? evt.event ?? evt.kind;
      if (t === "delta" || t === "text" || t === "message") yield { type: "delta", text: String(evt.text ?? evt.delta ?? evt.content ?? "") };
      else if (t === "thinking" || t === "reasoning") yield { type: "thinking", text: String(evt.text ?? "") };
      else if (t === "tool_call" || t === "tool") yield { type: "tool_call", tool: String(evt.tool ?? evt.name ?? "tool"), args: evt.args ?? evt.arguments, id: evt.id };
      else if (t === "tool_result") yield { type: "tool_result", tool: String(evt.tool ?? "tool"), result: String(evt.result ?? evt.output ?? "") };
      else if (t === "plan") yield { type: "plan", text: String(evt.text ?? evt.content ?? "") };
      else if (t === "permission" || t === "approval") yield { type: "permission", text: String(evt.text ?? evt.message ?? ""), id: evt.id };
      else if (typeof evt.content === "string" && evt.content) yield { type: "delta", text: evt.content };
      else if (typeof evt.text === "string" && evt.text) yield { type: "delta", text: evt.text };
    }
  }
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

async function assembleContext(db: any, channelId: string, agentName: string): Promise<ChatMessage[]> {
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
      role: r.senderId === names.get(r.senderId) ? ("assistant" as const) : ("user" as const),
      // simple heuristic: if sender is the agent bot, treat as assistant
      content: `${names.get(r.senderId) ?? "user"}: ${r.content}`,
    })),
  ];
  // mark actual bot messages as assistant without prefix
  // (we don't have bot id here yet; caller will patch if needed — keep simple)
  return chats;
}

export async function triggerAgentReply(
  app: FastifyInstance,
  args: { agent: AgentRow; channelId: string; promptMessageId?: string },
): Promise<boolean> {
  const db = (app as any).db;
  const redis = (app as any).redis;

  if (generating.has(args.agent.id)) return false;
  const ownerId = (args.agent as any).ownerId as string;
  if (ownerId && !(await checkRateLimit(redis, ownerId))) {
    await redis.publish("chat:events", JSON.stringify({ type: "agent:error", channelId: args.channelId, agentId: args.agent.id, error: "Rate limit: too many agent prompts, try again shortly." }));
    return false;
  }
  generating.add(args.agent.id);

  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(GENERATION_TIMEOUT_MS)]);
  if (args.promptMessageId) trackPrompt(args.promptMessageId, args.agent.id, controller);

  await redis.publish("chat:events", JSON.stringify({ type: "agent:typing", channelId: args.channelId, agentId: args.agent.id, isTyping: true }));

  try {
    const bot = await ensureAgentBotUser(app, args.agent);
    const messages = await assembleContext(db, args.channelId, args.agent.name);
    // patch messages so bot's own history is assistant role without prefix
    for (const m of messages) {
      if (m.content.startsWith(`${bot.name}: `)) m.content = m.content.slice(`${bot.name}: `.length);
    }

    let full = "";
    let reasoning = "";
    const toolCalls: Array<{ tool: string; args?: unknown }> = [];
    for await (const evt of streamAgent(args.agent, messages, signal)) {
      if (evt.type === "thinking") {
        reasoning += evt.text;
        await redis.publish("chat:events", JSON.stringify({ type: "agent:thinking", channelId: args.channelId, agentId: args.agent.id, delta: evt.text }));
      } else if (evt.type === "delta") {
        full += evt.text;
        await redis.publish("chat:events", JSON.stringify({ type: "agent:delta", channelId: args.channelId, agentId: args.agent.id, delta: evt.text }));
      } else if (evt.type === "tool_call") {
        toolCalls.push({ tool: evt.tool, args: evt.args });
        await redis.publish("chat:events", JSON.stringify({ type: "agent:tool", channelId: args.channelId, agentId: args.agent.id, tool: evt.tool, args: evt.args, id: evt.id }));
      } else if (evt.type === "tool_result") {
        await redis.publish("chat:events", JSON.stringify({ type: "agent:tool_result", channelId: args.channelId, agentId: args.agent.id, tool: evt.tool, result: evt.result }));
      } else if (evt.type === "plan") {
        await redis.publish("chat:events", JSON.stringify({ type: "agent:plan", channelId: args.channelId, agentId: args.agent.id, text: evt.text }));
      } else if (evt.type === "permission") {
        await redis.publish("chat:events", JSON.stringify({ type: "agent:permission", channelId: args.channelId, agentId: args.agent.id, text: evt.text, id: evt.id }));
      }
    }
    if (!full.trim() && toolCalls.length === 0) throw new Error("Agent returned an empty response");

    const id = ulid();
    const [msg] = await db
      .insert(message)
      .values({ id, channelId: args.channelId, senderId: bot.id, content: full.trim() || `[tool: ${toolCalls.map((t) => t.tool).join(", ")}]`, reasoning: reasoning.trim() || null })
      .returning();
    const withSender = { ...msg, sender: bot, attachments: [], reactions: [], agentId: args.agent.id };
    await redis.publish("chat:events", JSON.stringify({ type: "message:new", channelId: args.channelId, agentId: args.agent.id, message: withSender }));
    // also update agent heartbeat on success
    await db.update(agentRegistration).set({ status: "online", lastHeartbeatAt: new Date() }).where(eq(agentRegistration.id, args.agent.id));
    return true;
  } catch (e) {
    const cancelled = controller.signal.aborted;
    app.log.error(`agent generation ${cancelled ? "cancelled" : "failed"} (${args.agent.name}): ${(e as Error).message}`);
    if (!cancelled) {
      await redis.publish("chat:events", JSON.stringify({ type: "agent:error", channelId: args.channelId, agentId: args.agent.id, error: (e as Error).message }));
      await db.update(agentRegistration).set({ status: "error" }).where(eq(agentRegistration.id, args.agent.id));
    }
    return false;
  } finally {
    generating.delete(args.agent.id);
    if (args.promptMessageId) untrackPrompt(args.promptMessageId, args.agent.id, controller);
    await redis.publish("chat:events", JSON.stringify({ type: "agent:typing", channelId: args.channelId, agentId: args.agent.id, isTyping: false }));
  }
}

// helper to trigger from a channel message (future: @agent mention)
export async function maybeTriggerAgent(
  app: FastifyInstance,
  args: { channel: typeof channel.$inferSelect; senderId: string; content: string; messageId: string },
) {
  // For now agents are explicit — triggered via POST /api/agents/:id/prompt, not auto on mention.
  // Keep hook for future mention-based dispatch; no-op.
  void args;
}

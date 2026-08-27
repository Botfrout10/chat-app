import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  llmConnection,
  channel,
  channelMember,
  message,
  user as userTable,
} from "@chat/db/schema";

const CONTEXT_MESSAGES = 20;
const GENERATION_TIMEOUT_MS = 120_000;
const BOT_EMAIL_DOMAIN = "llm.local";

export type LlmConnectionRow = typeof llmConnection.$inferSelect;

// ---------------------------------------------------------------------------
// Bot user: each connection gets a synthetic user that authors its replies so
// AI messages are ordinary `message` rows (joins, search, notifications work).
// ---------------------------------------------------------------------------

export function botEmailFor(connectionId: string): string {
  return `llm+${connectionId}@${BOT_EMAIL_DOMAIN}`;
}

export async function ensureBotUser(app: FastifyInstance, conn: LlmConnectionRow) {
  const db = (app as any).db;
  if (conn.botUserId) {
    const [existing] = await db.select().from(userTable).where(eq(userTable.id, conn.botUserId));
    if (existing) return existing;
  }
  const [created] = await db
    .insert(userTable)
    .values({ id: ulid(), name: conn.label, email: botEmailFor(conn.id) })
    .onConflictDoNothing()
    .returning();
  const bot = created ?? (await db.select().from(userTable).where(eq(userTable.email, botEmailFor(conn.id))))[0];
  await db.update(llmConnection).set({ botUserId: bot.id }).where(eq(llmConnection.id, conn.id));
  conn.botUserId = bot.id;
  return bot;
}

// ---------------------------------------------------------------------------
// Provider call — OpenAI-compatible chat completions with SSE streaming
// ---------------------------------------------------------------------------

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type StreamDelta = { kind: "content" | "reasoning"; text: string };

async function* streamChatCompletion(
  conn: LlmConnectionRow,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<StreamDelta> {
  const res = await fetch(`${conn.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ model: conn.modelId, messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Provider responded ${res.status}: ${detail.slice(0, 300)}`);
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
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk?.choices?.[0]?.delta ?? {};
        // OpenAI-compatible reasoning models expose chain-of-thought as
        // `reasoning_content` (DeepSeek/LM Studio) or `reasoning` (others)
        const thinking = delta.reasoning_content ?? delta.reasoning;
        if (typeof thinking === "string" && thinking) yield { kind: "reasoning", text: thinking };
        if (typeof delta.content === "string" && delta.content) yield { kind: "content", text: delta.content };
      } catch {
        // partial/keepalive line — ignore
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reply orchestration — one generation at a time per connection
// ---------------------------------------------------------------------------

const generating = new Set<string>(); // connection ids currently mid-generation
// prompt message id -> all active generations for that prompt (supports multi-model @mentions)
// so deleting/editing the prompt cancels every generation it triggered
const activeByPrompt = new Map<string, Map<string, AbortController>>();

export function abortLlmGenerationForMessage(promptMessageId: string): boolean {
  const controllers = activeByPrompt.get(promptMessageId);
  if (!controllers?.size) return false;
  for (const c of controllers.values()) c.abort();
  activeByPrompt.delete(promptMessageId);
  return true;
}

function trackPrompt(promptMessageId: string, connId: string, controller: AbortController) {
  let m = activeByPrompt.get(promptMessageId);
  if (!m) {
    m = new Map();
    activeByPrompt.set(promptMessageId, m);
  }
  m.set(connId, controller);
}

function untrackPrompt(promptMessageId: string, connId: string, controller: AbortController) {
  const m = activeByPrompt.get(promptMessageId);
  if (!m) return;
  if (m.get(connId) === controller) m.delete(connId);
  if (m.size === 0) activeByPrompt.delete(promptMessageId);
}

// per-user completion rate limit (mention-triggered + DM auto-reply)
// 20 generations per minute per user — protects provider quota and prevents spam loops
async function checkLlmCompletionRateLimit(redis: any, userId: string): Promise<boolean> {
  try {
    const { registerRateLimitCommands } = await import("./rateLimit.js");
    registerRateLimitCommands(redis);
    const key = `rl:llm-complete:${userId}`;
    const member = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // 20 per 60s
    const [allowedRaw] = (await redis.slidingWindow(key, Date.now(), 60_000, 20, member)) as number[];
    return Number(allowedRaw) === 1;
  } catch {
    // if redis fails, allow (fail open) — don't block chat
    return true;
  }
}

async function assembleContext(db: any, conn: LlmConnectionRow, channelId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select({ senderId: message.senderId, content: message.content })
    .from(message)
    .where(and(eq(message.channelId, channelId), isNull(message.deletedAt)))
    .orderBy(desc(message.id))
    .limit(CONTEXT_MESSAGES);
  const history = rows.reverse();
  // sender names help the model follow multi-party conversations
  const ids: string[] = [...new Set<string>(history.map((r: any) => r.senderId))];
  const senders = ids.length
    ? await db.select({ id: userTable.id, name: userTable.name }).from(userTable).where(inArray(userTable.id, ids))
    : [];
  const names = new Map(senders.map((u: any) => [u.id, u.name]));
  const chats: ChatMessage[] = [
    {
      role: "system",
      content:
        `You are "${conn.label}" (mention as @${conn.mentionName}), an AI assistant inside a team chat app. ` +
        `Reply concisely. Messages are prefixed with their author's name when known.`,
    },
    ...history.map((r: any) => ({
      role: r.senderId === conn.botUserId ? ("assistant" as const) : ("user" as const),
      content: r.senderId === conn.botUserId ? r.content : `${names.get(r.senderId) ?? "user"}: ${r.content}`,
    })),
  ];
  return chats;
}

export async function triggerLlmReply(
  app: FastifyInstance,
  args: { conn: LlmConnectionRow; channelId: string; promptMessageId?: string },
): Promise<boolean> {
  const db = (app as any).db;
  const redis = (app as any).redis;

  if (!args.conn.botUserId) await ensureBotUser(app, args.conn);
  if (generating.has(args.conn.id)) return false; // one generation at a time per connection
  // per-user completion rate limit (protect provider quota)
  const ownerId = (args.conn as any).ownerId as string;
  if (ownerId && !(await checkLlmCompletionRateLimit(redis, ownerId))) {
    await redis.publish("chat:events", JSON.stringify({
      type: "llm:error", channelId: args.channelId, connectionId: args.conn.id, error: "Rate limit: too many AI replies, try again shortly.",
    }));
    return false;
  }
  generating.add(args.conn.id);

  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(GENERATION_TIMEOUT_MS)]);
  if (args.promptMessageId) {
    trackPrompt(args.promptMessageId, args.conn.id, controller);
  }

  // typing indicator for the duration of generation
  await redis.publish("chat:events", JSON.stringify({
    type: "llm:typing", channelId: args.channelId, connectionId: args.conn.id, isTyping: true,
  }));

  try {
    const messages = await assembleContext(db, args.conn, args.channelId);
    let full = "";
    let reasoning = "";
    for await (const delta of streamChatCompletion(args.conn, messages, signal)) {
      if (delta.kind === "reasoning") {
        reasoning += delta.text;
        await redis.publish("chat:events", JSON.stringify({
          type: "llm:thinking", channelId: args.channelId, connectionId: args.conn.id, delta: delta.text,
        }));
      } else {
        full += delta.text;
        await redis.publish("chat:events", JSON.stringify({
          type: "llm:delta", channelId: args.channelId, connectionId: args.conn.id, delta: delta.text,
        }));
      }
    }
    if (!full.trim()) throw new Error("Provider returned an empty completion");

    const id = ulid();
    const [msg] = await db
      .insert(message)
      .values({
        id,
        channelId: args.channelId,
        senderId: args.conn.botUserId!,
        content: full.trim(),
        reasoning: reasoning.trim() || null,
      })
      .returning();
    const [bot] = await db.select().from(userTable).where(eq(userTable.id, args.conn.botUserId!));
    const withSender = { ...msg, sender: bot, attachments: [], reactions: [], llmConnectionId: args.conn.id };
    await redis.publish("chat:events", JSON.stringify({
      type: "message:new", channelId: args.channelId, llmConnectionId: args.conn.id, message: withSender,
    }));
    return true;
  } catch (e) {
    const cancelled = controller.signal.aborted;
    app.log.error(`llm generation ${cancelled ? "cancelled" : "failed"} (${args.conn.label}): ${(e as Error).message}`);
    if (!cancelled) {
      await redis.publish("chat:events", JSON.stringify({
        type: "llm:error", channelId: args.channelId, connectionId: args.conn.id, error: (e as Error).message,
      }));
    }
    return false;
  } finally {
    generating.delete(args.conn.id);
    if (args.promptMessageId) untrackPrompt(args.promptMessageId, args.conn.id, controller);
    await redis.publish("chat:events", JSON.stringify({
      type: "llm:typing", channelId: args.channelId, connectionId: args.conn.id, isTyping: false,
    }));
  }
}

// Decide whether a just-sent human message should wake an LLM:
// - DM channels where the peer is a bot user owned by the sender → always reply
// - @mentionName tokens matching connections owned by the sender → reply once each
export async function maybeTriggerLlm(
  app: FastifyInstance,
  args: { channel: typeof channel.$inferSelect; senderId: string; content: string; messageId: string },
) {
  try {
    const db = (app as any).db;
    const conns: LlmConnectionRow[] = await db
      .select()
      .from(llmConnection)
      .where(eq(llmConnection.ownerId, args.senderId));
    if (!conns.length) return;

    const byBot = new Map(conns.filter((c) => c.botUserId).map((c) => [c.botUserId!, c]));

    // DM auto-reply: peer is a bot user of one of my connections
    if (args.channel.type === "dm") {
      const members = await db
        .select({ userId: channelMember.userId })
        .from(channelMember)
        .where(eq(channelMember.channelId, args.channel.id));
      const peer = members.find((m: any) => m.userId !== args.senderId);
      if (peer && byBot.has(peer.userId)) {
        void triggerLlmReply(app, { conn: byBot.get(peer.userId)!, channelId: args.channel.id, promptMessageId: args.messageId });
        return;
      }
    }

    // mention-triggered: match my connections' mention names / labels against @tokens
    // mirrors the second pass in messages.ts (mentionName + label, lowercased)
    const tokens = new Set((args.content.match(/@([\p{L}\p{N}_.-]+)/gu) ?? []).map((t) => t.slice(1).toLowerCase()));
    if (!tokens.size) return;
    for (const conn of conns) {
      const mname = String(conn.mentionName ?? "").toLowerCase();
      const label = String(conn.label ?? "").toLowerCase();
      const matched = (mname && tokens.has(mname)) || (label && tokens.has(label));
      if (matched) {
        void triggerLlmReply(app, { conn, channelId: args.channel.id, promptMessageId: args.messageId });
      }
    }
  } catch (e) {
    app.log.error(`llm trigger check failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Per-connection DM channel (find-or-create, mirrors human DM naming)
// ---------------------------------------------------------------------------

export async function findOrCreateLlmDm(app: FastifyInstance, conn: LlmConnectionRow, userId: string, workspaceId: string) {
  const db = (app as any).db;
  const bot = await ensureBotUser(app, conn);
  const pair = [userId, bot.id].sort().join(":");
  const name = `dm-${createHash("sha1").update(pair).digest("hex").slice(0, 12)}`;

  const [existing] = await db
    .select()
    .from(channel)
    .where(and(eq(channel.workspaceId, workspaceId), eq(channel.type, "dm"), eq(channel.name, name)));
  if (existing) return { ...existing, created: false };

  const chId = ulid();
  const [ch] = await db
    .insert(channel)
    .values({ id: chId, workspaceId, name, type: "dm", createdBy: userId })
    .returning();
  await db
    .insert(channelMember)
    .values([
      { channelId: chId, userId },
      { channelId: chId, userId: bot.id },
    ])
    .onConflictDoNothing();
  return { ...ch, created: true };
}

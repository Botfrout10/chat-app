import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { ulid } from "ulid";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@chat/db";
import { channel, channelMember, user, message as messageTable, notification } from "@chat/db/schema";
import { env } from "../lib/env.js";
import { sendMail } from "../lib/mail.js";

type NotifyJobData = {
  message: {
    id: string;
    channelId: string;
    senderId: string;
    parentId?: string | null;
    content: string;
    sender?: { name?: string } | null;
  };
  channel: { id: string; name: string; type: string; workspaceId: string };
};

type Kind = "mention" | "dm" | "thread" | "channel";

let _worker: Worker | null = null;

export function startNotificationWorker(): Worker {
  if (_worker) return _worker;
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  _worker = new Worker<NotifyJobData>("notifications", (job) => processNotification(job, connection), {
    connection,
    concurrency: 5,
  });
  _worker.on("completed", (job) => console.log(`[notifications] job ${job.id} done`));
  _worker.on("failed", (job, err) => console.error(`[notifications] job ${job?.id} failed: ${err.message}`));
  console.log("[notifications] worker started");
  return _worker;
}

function extractMentionTokens(content: string): Set<string> {
  const matches = content.match(/@([\p{L}\p{N}_.-]+)/gu) ?? [];
  return new Set(matches.map((m) => m.slice(1).toLowerCase()));
}

async function processNotification(job: Job<NotifyJobData>, connection: IORedis) {
  const db = getDb(env.DATABASE_URL);
  const msg = job.data.message;
  const [ch] = await db.select().from(channel).where(eq(channel.id, msg.channelId));
  if (!ch) return;

  const { llmConnection } = await import("@chat/db/schema");

  // AI replies never notify: the requester is watching the stream live
  const [botConn] = await db
    .select({ id: llmConnection.id })
    .from(llmConnection)
    .where(eq(llmConnection.botUserId, msg.senderId));
  if (botConn) return;

  const rows = await db
    .select({ u: user, cm: channelMember })
    .from(channelMember)
    .innerJoin(user, eq(channelMember.userId, user.id))
    .where(eq(channelMember.channelId, ch.id));

  // never target bot users either (e.g. human prompt inside an LLM dm)
  const memberIds = rows.map((r) => r.u.id);
  const botIds = new Set(
    memberIds.length
      ? (await db.select({ id: llmConnection.botUserId }).from(llmConnection).where(inArray(llmConnection.botUserId, memberIds))).map((r) => r.id)
      : []
  );

  // DB-recorded mentions are authoritative; regex tokens as fallback for robustness
  // only type='user' counts for human notifications — llm mentions (type='llm') are excluded
  let dbMentionIds = new Set<string>();
  try {
    const { mention } = await import("@chat/db/schema");
    const mrows = await db.select().from(mention).where(eq(mention.messageId, msg.id));
    dbMentionIds = new Set(mrows.filter((m: any) => (m as any).type !== "llm").map((m) => m.mentionedUserId));
  } catch {}
  const mentionTokens = extractMentionTokens(String(msg.content));
  const senderName = msg.sender?.name ?? "Someone";

  type Target = { userId: string; email: string; name: string; kind: Kind };
  const targets = new Map<string, Target>();

  for (const { u, cm } of rows) {
    if (u.id === msg.senderId) continue;
    if (botIds.has(u.id)) continue;
    if (cm.notificationPref === "nothing") continue;
    const uname = (u.name ?? "").toLowerCase();
    const ulocal = (u.email ?? "").split("@")[0]?.toLowerCase() ?? "";
    const isMention = dbMentionIds.has(u.id) || mentionTokens.has(uname) || (ulocal.length > 0 && mentionTokens.has(ulocal));
    const isDirectSpace = ch.type === "dm" || ch.type === "group";
    const kind: Kind | null = isMention ? "mention" : isDirectSpace ? "dm" : cm.notificationPref === "all" ? "channel" : null;
    if (!kind) continue;
    targets.set(u.id, { userId: u.id, email: u.email, name: u.name, kind });
  }

  if (msg.parentId) {
    const [parent] = await db.select().from(messageTable).where(eq(messageTable.id, msg.parentId));
    if (parent && parent.senderId !== msg.senderId && !botIds.has(parent.senderId)) {
      const entry = rows.find((r) => r.u.id === parent.senderId);
      if (entry && entry.cm.notificationPref !== "nothing") {
        const existing = targets.get(parent.senderId);
        if (existing && existing.kind === "channel") existing.kind = "thread";
        else if (!existing) {
          targets.set(parent.senderId, { userId: parent.senderId, email: entry.u.email, name: entry.u.name, kind: "thread" });
        }
      }
    }
  }

  const verb: Record<Kind, string> = {
    mention: "mentioned you",
    dm: "sent you a message",
    thread: "replied to your thread",
    channel: "posted in",
  };

  for (const t of targets.values()) {
    const id = ulid();
    const place = t.kind === "channel" || t.kind === "thread" ? ` in #${ch.name}` : "";
    const title = `${senderName} ${verb[t.kind]}${place}`;
    const body = String(msg.content).slice(0, 280);
    await db.insert(notification).values({
      id,
      userId: t.userId,
      workspaceId: ch.workspaceId,
      channelId: ch.id,
      messageId: msg.id,
      type: t.kind,
      title,
      body,
    });

    await connection.publish(
      "chat:events",
      JSON.stringify({
        type: "notification:new",
        userId: t.userId,
        notification: { id, type: t.kind, title, body, channelId: ch.id, messageId: msg.id, createdAt: new Date().toISOString(), read: false },
      })
    );

    if (t.kind !== "channel" && t.email) {
      const preview = body.length >= 280 ? `${body}…` : body;
      await sendMail({
        to: t.email,
        subject: `[Pulse] ${title}`,
        text: `${preview}\n\n— ${senderName} in #${ch.name}\nOpen Pulse to reply.`,
        html: `<div style="font-family:sans-serif;max-width:480px"><h3 style="color:#b7791f;margin:0 0 8px">${title}</h3><p style="color:#2b1d0f;background:#fdfbf0;border:1px solid #e8ddd0;border-radius:8px;padding:12px">${escapeHtml(preview)}</p><p style="color:#6b5a44;font-size:13px">— <b>${escapeHtml(senderName)}</b> in <b>#${ch.name}</b></p></div>`,
      });
    }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function stopNotificationWorker() {
  if (_worker) await _worker.close();
  _worker = null;
}

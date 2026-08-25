import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { and, eq, lt, gt, desc, asc, sql } from "drizzle-orm";
import { message, channelMember, channel, reaction, attachment, workspaceMember, mention } from "@chat/db/schema";
import { sendMessageSchema, editMessageSchema, reactionSchema } from "@chat/shared/schemas";
import { enforceRate } from "../lib/rateLimit.js";

export async function registerMessageRoutes(app: FastifyInstance) {
  // list messages with cursor pagination: ?before=<ulid>&after=<ulid>&limit=50
  app.get("/api/channels/:id/messages", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id: channelId } = req.params as any;
    const { before, after, limit } = req.query as any;
    const lim = Math.min(Math.max(Number(limit ?? 50), 1), 100);
    const db = (app as any).db;

    // auth: must be channel member or public channel + workspace member
    const [ch] = await db.select().from(channel).where(eq(channel.id, channelId));
    if (!ch) return reply.code(404).send({ error: "Channel not found" });
    const [cm] = await db.select().from(channelMember).where(and(eq(channelMember.channelId, channelId), eq(channelMember.userId, user.id)));
    if (!cm && ch.type !== "public") return reply.code(403).send({ error: "Forbidden" });
    if (!cm && ch.type === "public") {
      const [wm] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, ch.workspaceId), eq(workspaceMember.userId, user.id)));
      if (!wm) return reply.code(403).send({ error: "Forbidden" });
    }

    const conditions: any[] = [eq(message.channelId, channelId)];
    if (before) conditions.push(lt(message.id, before as string));
    if (after) conditions.push(gt(message.id, after as string));
    // when after is set, we want ASC (sync missed), otherwise DESC (latest)
    const order = after ? asc(message.id) : desc(message.id);
    const rows = await db
      .select()
      .from(message)
      .where(and(...conditions))
      .orderBy(order)
      .limit(lim + 1);

    // join sender + attachments + reactions in separate queries for simplicity
    const hasMore = rows.length > lim;
    const slice = hasMore ? rows.slice(0, lim) : rows;
    const ordered = after ? slice : slice; // keep order as queried; client can reverse if needed
    // For DESC we return newest first; client will reverse to display oldest first.
    // Provide nextCursor = last id (for before pagination) and prevCursor for after.

    const ids = ordered.map((r: any) => r.id);
    let attachmentsByMessage = new Map<string, any[]>();
    let reactionsByMessage = new Map<string, any[]>();
    if (ids.length) {
      const { inArray } = await import("drizzle-orm");
      const atts = await db.select().from(attachment).where(inArray(attachment.messageId, ids));
      for (const a of atts) {
        if (!attachmentsByMessage.has(a.messageId)) attachmentsByMessage.set(a.messageId, []);
        attachmentsByMessage.get(a.messageId)!.push(a);
      }
      const reacts = await db.select().from(reaction).where(inArray(reaction.messageId, ids));
      for (const r of reacts) {
        if (!reactionsByMessage.has(r.messageId)) reactionsByMessage.set(r.messageId, []);
        reactionsByMessage.get(r.messageId)!.push(r);
      }
      // fetch senders
      const { user: userTable } = await import("@chat/db/schema");
      const senders = await db.select().from(userTable).where(inArray(userTable.id, ordered.map((m: any) => m.senderId)));
      const senderMap = new Map(senders.map((u: any) => [u.id, u]));
      for (const m of ordered) {
        (m as any).sender = senderMap.get(m.senderId) ?? null;
        (m as any).attachments = attachmentsByMessage.get(m.id) ?? [];
        (m as any).reactions = reactionsByMessage.get(m.id) ?? [];
      }
    }

    // cursor for next page: when using before (DESC), nextCursor = last.id
    // when using after (ASC), nextCursor = last.id for continued forward pagination
    const nextCursor = hasMore ? ordered[ordered.length - 1]?.id : null;
    // For initial DESC pagination, expose nextCursor as `before` for next fetch
    return { messages: ordered, nextCursor, hasMore };
  });

  // send message — 10 per 10s per user (spam guard)
  app.post("/api/channels/:id/messages", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "msg-send", max: 10, windowMs: 10_000, subject: user.id }))) return;
    const { id: channelId } = req.params as any;
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const db = (app as any).db;
    const [ch] = await db.select().from(channel).where(eq(channel.id, channelId));
    if (!ch) return reply.code(404).send({ error: "Channel not found" });
    // must be member (or public workspace member)
    const [cm] = await db.select().from(channelMember).where(and(eq(channelMember.channelId, channelId), eq(channelMember.userId, user.id)));
    if (!cm && ch.type !== "public") return reply.code(403).send({ error: "Forbidden" });
    if (!cm && ch.type === "public") {
      const [wm] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, ch.workspaceId), eq(workspaceMember.userId, user.id)));
      if (!wm) return reply.code(403).send({ error: "Forbidden" });
      // auto-join public channel on send
      await db.insert(channelMember).values({ channelId, userId: user.id }).onConflictDoNothing();
    }

    // idempotency: if nonce provided and exists, return existing
    if (parsed.data.nonce) {
      const [existing] = await db.select().from(message).where(and(eq(message.channelId, channelId), eq(message.nonce, parsed.data.nonce)));
      if (existing) return existing;
    }

    // if parentId provided, verify it belongs to same channel
    if (parsed.data.parentId) {
      const [parent] = await db.select().from(message).where(eq(message.id, parsed.data.parentId));
      if (!parent || parent.channelId !== channelId) return reply.code(400).send({ error: "Invalid parentId" });
    }

    const id = ulid();
    const [msg] = await db
      .insert(message)
      .values({
        id,
        channelId,
        senderId: user.id,
        parentId: parsed.data.parentId ?? null,
        content: parsed.data.content,
        nonce: parsed.data.nonce ?? null,
      })
      .returning();

    // attachments: client presigned+uploaded already; persist real metadata for previews
    const attRows: any[] = [];
    if (parsed.data.attachments?.length) {
      for (const a of parsed.data.attachments) {
        const row = {
          id: ulid(),
          messageId: id,
          key: a.key,
          filename: a.filename,
          mime: a.mime,
          size: a.size,
        };
        await db.insert(attachment).values(row);
        attRows.push(row);
      }
    }

    // mentions: match @tokens against workspace member names/emails
    const mentionRows: { messageId: string; channelId: string; mentionedUserId: string; senderId: string }[] = [];
    try {
      const tokens = new Set((parsed.data.content.match(/@([\p{L}\p{N}_.-]+)/gu) ?? []).map((t) => t.slice(1).toLowerCase()));
      if (tokens.size) {
        const { user: userTable, workspaceMember: wm, mention } = await import("@chat/db/schema");
        const candidates = await db
          .select({ u: userTable })
          .from(wm)
          .innerJoin(userTable, eq(wm.userId, userTable.id))
          .where(eq(wm.workspaceId, ch.workspaceId));
        for (const { u } of candidates) {
          if (u.id === user.id) continue;
          const uname = (u.name ?? "").toLowerCase();
          const ulocal = (u.email ?? "").split("@")[0]?.toLowerCase() ?? "";
          if ((uname && tokens.has(uname)) || (ulocal && tokens.has(ulocal))) {
            mentionRows.push({ messageId: id, channelId, mentionedUserId: u.id, senderId: user.id });
          }
        }
        if (mentionRows.length) {
          await db.insert(mention).values(mentionRows).onConflictDoNothing();
        }
      }
    } catch (e) {
      app.log.error(`mention parse failed: ${(e as Error).message}`);
    }

    const withSender = { ...msg, sender: user, attachments: attRows, reactions: [], mentions: mentionRows.map((m) => m.mentionedUserId) };

    // publish to redis for WS fanout
    const redis = (app as any).redis;
    await redis.publish("chat:events", JSON.stringify({ type: "message:new", channelId, message: withSender }));

    // enqueue notification job (BullMQ worker handles mentions/DM/thread/channel prefs)
    try {
      const { getNotificationQueue } = await import("../lib/queue.js");
      await getNotificationQueue().add("notify", { message: withSender, channel: ch });
    } catch (e) {
      app.log.error(`enqueue notification failed: ${(e as Error).message}`);
    }

    return withSender;
  });

  // edit message (own only, within 15 min, not deleted)
  app.patch("/api/messages/:id", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const parsed = editMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const db = (app as any).db;
    const [msg] = await db.select().from(message).where(eq(message.id, id));
    if (!msg) return reply.code(404).send({ error: "Not found" });
    if (msg.senderId !== user.id) return reply.code(403).send({ error: "Only author can edit" });
    if (msg.deletedAt) return reply.code(400).send({ error: "Message deleted" });
    const [updated] = await db.update(message).set({ content: parsed.data.content, editedAt: new Date() }).where(eq(message.id, id)).returning();
    const redis = (app as any).redis;
    await redis.publish("chat:events", JSON.stringify({ type: "message:updated", channelId: msg.channelId, message: updated }));
    return updated;
  });

  app.delete("/api/messages/:id", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const db = (app as any).db;
    const [msg] = await db.select().from(message).where(eq(message.id, id));
    if (!msg) return reply.code(404).send({ error: "Not found" });
    if (msg.senderId !== user.id) return reply.code(403).send({ error: "Only author can delete" });
    if (msg.deletedAt) return reply.code(400).send({ error: "Already deleted" });
    const [deleted] = await db.update(message).set({ deletedAt: new Date(), content: "[deleted]" }).where(eq(message.id, id)).returning();
    const redis = (app as any).redis;
    await redis.publish("chat:events", JSON.stringify({ type: "message:deleted", channelId: msg.channelId, messageId: id }));
    return deleted;
  });

  // reactions
  app.post("/api/messages/:id/reactions", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "react", max: 30, windowMs: 60_000, subject: user.id }))) return;
    const { id: messageId } = req.params as any;
    const parsed = reactionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const db = (app as any).db;
    await db.insert(reaction).values({ messageId, userId: user.id, emoji: parsed.data.emoji }).onConflictDoNothing();
    const redis = (app as any).redis;
    const [msg] = await db.select().from(message).where(eq(message.id, messageId));
    if (msg) await redis.publish("chat:events", JSON.stringify({ type: "reaction:update", channelId: msg.channelId, messageId, emoji: parsed.data.emoji, userId: user.id, action: "added" }));
    return { ok: true };
  });

  app.delete("/api/messages/:id/reactions/:emoji", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id: messageId, emoji } = req.params as any;
    const db = (app as any).db;
    await db.delete(reaction).where(and(eq(reaction.messageId, messageId), eq(reaction.userId, user.id), eq(reaction.emoji, emoji)));
    const redis = (app as any).redis;
    const [msg] = await db.select().from(message).where(eq(message.id, messageId));
    if (msg) await redis.publish("chat:events", JSON.stringify({ type: "reaction:update", channelId: msg.channelId, messageId, emoji, userId: user.id, action: "removed" }));
    return { ok: true };
  });

  // thread replies: GET /api/messages/:id/replies
  app.get("/api/messages/:id/replies", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const db = (app as any).db;
    const replies = await db.select().from(message).where(eq(message.parentId, id)).orderBy(asc(message.id));
    return replies;
  });
}

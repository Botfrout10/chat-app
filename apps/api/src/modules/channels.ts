import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { and, eq, inArray } from "drizzle-orm";
import { channel, channelMember, llmConnection, workspaceMember } from "@chat/db/schema";
import { createChannelSchema } from "@chat/shared/schemas";

export async function registerChannelRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:workspaceId/channels", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { workspaceId } = req.params as any;
    const db = (app as any).db;
    const [member] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, user.id)));
    if (!member) return reply.code(403).send({ error: "Forbidden" });
    const chans = await db.select().from(channel).where(eq(channel.workspaceId, workspaceId));
    // for private channels, only return where user is member
    const all = await db.select().from(channelMember).where(eq(channelMember.userId, user.id));
    const myChannelIds = new Set(all.map((r: any) => r.channelId));
    const visible = chans.filter((c: any) => c.type === "public" || myChannelIds.has(c.id));

    // attach unread hint and peer info for dm/group channels
    const { user: userTable } = await import("@chat/db/schema");
    const readRows = await db
      .select({ channelId: channelMember.channelId, lastReadMessageId: channelMember.lastReadMessageId })
      .from(channelMember)
      .where(eq(channelMember.userId, user.id));
    const readByChannel = new Map<string, string | null>(readRows.map((r: any) => [r.channelId, r.lastReadMessageId]));
    for (const c of visible) (c as any).lastReadMessageId = readByChannel.get(c.id) ?? null;

    // attach peer info for dm/group channels so the UI can title them
    const social = visible.filter((c: any) => c.type === "dm" || c.type === "group");
    for (const c of social) {
      const rows = await db
        .select({ u: userTable })
        .from(channelMember)
        .innerJoin(userTable, eq(channelMember.userId, userTable.id))
        .where(eq(channelMember.channelId, c.id));
      const peers = rows.map((r: any) => ({ id: r.u.id, name: r.u.name })).filter((p: any) => p.id !== user.id);
      (c as any).dmPeer = c.type === "dm" ? peers[0] ?? null : peers;
    }

    // attach llmConnectionId for AI model DM channels (personal bots)
    // so the context indicator can stay visible after refresh/reload
    try {
      const conns = await db.select().from(llmConnection).where(eq(llmConnection.ownerId, user.id));
      const botToConn = new Map<string, string>();
      const connMeta = new Map<string, { label: string; modelId: string; capabilities: any }>();
      for (const conn of conns as any[]) {
        if (conn.botUserId) {
          botToConn.set(conn.botUserId, conn.id);
          connMeta.set(conn.id, { label: conn.label, modelId: conn.modelId, capabilities: conn.capabilities });
        }
      }
      if (botToConn.size && visible.length) {
        const visibleIds = visible.map((c: any) => c.id);
        const botIds = [...botToConn.keys()];
        const botMembers = await db
          .select({ channelId: channelMember.channelId, userId: channelMember.userId })
          .from(channelMember)
          .where(and(inArray(channelMember.channelId, visibleIds as string[]), inArray(channelMember.userId, botIds as string[])));
        const chanToConn = new Map<string, string>();
        for (const r of botMembers as any[]) {
          const cid = botToConn.get(r.userId);
          if (cid) chanToConn.set(r.channelId, cid);
        }
        for (const c of visible as any[]) {
          const connId = chanToConn.get(c.id) ?? null;
          c.llmConnectionId = connId;
          if (connId) {
            const meta = connMeta.get(connId);
            if (meta) {
              c.modelLabel = meta.label;
              c.modelId = meta.modelId;
            }
          } else {
            c.llmConnectionId = null;
          }
        }
      } else {
        for (const c of visible as any[]) c.llmConnectionId = null;
      }
    } catch {
      // don't fail channel list on llm lookup
      for (const c of visible as any[]) if (!("llmConnectionId" in c)) (c as any).llmConnectionId = null;
    }
    return visible;
  });

  app.post("/api/workspaces/:workspaceId/channels", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { workspaceId } = req.params as any;
    const parsed = createChannelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const db = (app as any).db;
    const [member] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, user.id)));
    if (!member) return reply.code(403).send({ error: "Forbidden" });
    const id = ulid();
    const [ch] = await db.insert(channel).values({ id, workspaceId, name: parsed.data.name, type: parsed.data.type, createdBy: user.id }).returning();
    // creator auto-joins
    await db.insert(channelMember).values({ channelId: id, userId: user.id });
    // for dm/group with memberIds, add them
    if (parsed.data.memberIds?.length) {
      for (const uid of parsed.data.memberIds) {
        // ensure they are workspace members
        const [isWm] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, uid)));
        if (isWm) await db.insert(channelMember).values({ channelId: id, userId: uid }).onConflictDoNothing();
      }
    }
    return ch;
  });

  app.post("/api/channels/:id/join", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const db = (app as any).db;
    const [ch] = await db.select().from(channel).where(eq(channel.id, id));
    if (!ch) return reply.code(404).send({ error: "Not found" });
    const [wm] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, ch.workspaceId), eq(workspaceMember.userId, user.id)));
    if (!wm) return reply.code(403).send({ error: "Not in workspace" });
    await db.insert(channelMember).values({ channelId: id, userId: user.id }).onConflictDoNothing();
    return { ok: true };
  });

  app.get("/api/channels/:id/members", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const db = (app as any).db;
    const [isMember] = await db.select().from(channelMember).where(and(eq(channelMember.channelId, id), eq(channelMember.userId, user.id)));
    // allow if public and workspace member
    if (!isMember) {
      const [ch] = await db.select().from(channel).where(eq(channel.id, id));
      if (!ch) return reply.code(404).send({ error: "Not found" });
      if (ch.type !== "public") return reply.code(403).send({ error: "Forbidden" });
      const [wm] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, ch.workspaceId), eq(workspaceMember.userId, user.id)));
      if (!wm) return reply.code(403).send({ error: "Forbidden" });
    }
    const { user: userTable } = await import("@chat/db/schema");
    const rows = await db
      .select()
      .from(channelMember)
      .innerJoin(userTable, eq(channelMember.userId, userTable.id))
      .where(eq(channelMember.channelId, id));
    return rows.map((r: any) => ({ ...r.user, lastReadMessageId: r.channel_member.lastReadMessageId }));
  });

  app.patch("/api/channels/:id/read", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const { lastReadMessageId } = req.body as any;
    const db = (app as any).db;
    await db.update(channelMember).set({ lastReadMessageId }).where(and(eq(channelMember.channelId, id), eq(channelMember.userId, user.id)));
    // broadcast via redis/socket
    const redis = (app as any).redis;
    await redis.publish("chat:events", JSON.stringify({ type: "read:receipt", channelId: id, userId: user.id, lastReadMessageId }));
    return { ok: true };
  });
}

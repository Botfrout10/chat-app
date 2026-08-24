import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { and, eq } from "drizzle-orm";
import { channel, channelMember, workspaceMember } from "@chat/db/schema";
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
    return chans.filter((c: any) => c.type === "public" || myChannelIds.has(c.id));
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

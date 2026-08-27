import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { eq, and, or, sql } from "drizzle-orm";
import { workspace, workspaceMember, channel, channelMember, user as userTable } from "@chat/db/schema";
import { createWorkspaceSchema, inviteSchema, addMemberSchema, createDmSchema } from "@chat/shared/schemas";
import { slugify } from "@chat/shared/utils";

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  app.get("/api/workspaces", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const db = (app as any).db;
    const rows = await db
      .select({ workspace })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
      .where(eq(workspaceMember.userId, user.id));
    return rows.map((r: any) => r.workspace);
  });

  app.post("/api/workspaces", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const parsed = createWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const db = (app as any).db;
    const id = ulid();
    let slug = slugify(parsed.data.name);
    if (!slug) slug = id.toLowerCase().slice(0, 8);
    // ensure unique slug
    const existing = await db.select().from(workspace).where(eq(workspace.slug, slug));
    if (existing.length) slug = `${slug}-${id.slice(-4).toLowerCase()}`;
    const [ws] = await db.insert(workspace).values({ id, name: parsed.data.name, slug, ownerId: user.id }).returning();
    await db.insert(workspaceMember).values({ workspaceId: id, userId: user.id, role: "owner" });
    // default channels
    const generalId = ulid();
    const randomId = ulid();
    await db.insert(channel).values([
      { id: generalId, workspaceId: id, name: "general", type: "public", createdBy: user.id },
      { id: randomId, workspaceId: id, name: "random", type: "public", createdBy: user.id },
    ]);
    await db.insert(channelMember).values([
      { channelId: generalId, userId: user.id },
      { channelId: randomId, userId: user.id },
    ]);
    return ws;
  });

  app.get("/api/workspaces/:id", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const db = (app as any).db;
    const [ws] = await db.select().from(workspace).where(eq(workspace.id, id));
    if (!ws) return reply.code(404).send({ error: "Not found" });
    const [member] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, id), eq(workspaceMember.userId, user.id)));
    if (!member) return reply.code(403).send({ error: "Forbidden" });
    return ws;
  });

  app.get("/api/workspaces/:id/members", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const db = (app as any).db;
    const [isMember] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, id), eq(workspaceMember.userId, user.id)));
    if (!isMember) return reply.code(403).send({ error: "Forbidden" });
    const rows = await db
      .select()
      .from(workspaceMember)
      .innerJoin(userTable, eq(workspaceMember.userId, userTable.id))
      .where(eq(workspaceMember.workspaceId, id));
    return rows.map((r: any) => ({ ...r.user, role: r.workspace_member.role, joinedAt: r.workspace_member.joinedAt }));
  });

  // add an existing registered user to the workspace by name or email
  app.post("/api/workspaces/:id/members", async (req, reply) => {
    const actor = await (app as any).getSessionUser(req);
    if (!actor) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const db = (app as any).db;

    const [actorRow] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, id), eq(workspaceMember.userId, actor.id)));
    if (!actorRow || (actorRow.role !== "owner" && actorRow.role !== "admin")) {
      return reply.code(403).send({ error: "Only owner/admin can add members" });
    }

    const q = parsed.data.user.trim();
    // newest match wins when several users share a name
    const candidates = await db
      .select()
      .from(userTable)
      .where(or(sql`lower(${userTable.name}) = lower(${q})`, sql`lower(${userTable.email}) = lower(${q})`))
      .orderBy(sql`${userTable.createdAt} DESC`)
      .limit(1);
    const target = candidates[0];
    if (!target) {
      return reply.code(404).send({ error: `No registered user found for “${q}”`, code: "USER_NOT_FOUND" });
    }

    const [already] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, id), eq(workspaceMember.userId, target.id)));
    if (already) return reply.code(409).send({ error: `${target.name} is already a member`, code: "ALREADY_MEMBER" });

    await db.insert(workspaceMember).values({ workspaceId: id, userId: target.id, role: parsed.data.role });
    const publicChannels = await db.select().from(channel).where(and(eq(channel.workspaceId, id), eq(channel.type, "public")));
    for (const c of publicChannels) {
      await db.insert(channelMember).values({ channelId: c.id, userId: target.id }).onConflictDoNothing();
    }
    // notify the added user so their Activity feed updates and they see the new workspace without re-login
    try {
      const { notification } = await import("@chat/db/schema");
      const [ws] = await db.select().from(workspace).where(eq(workspace.id, id));
      const nid = ulid();
      const title = `${actor.name} added you to ${ws?.name ?? "a workspace"}`;
      const body = `You now have access to ${ws?.name ?? id}. Open Pulse to start chatting.`;
      const firstChannelId = publicChannels[0]?.id ?? null;
      await db.insert(notification).values({
        id: nid,
        userId: target.id,
        workspaceId: id,
        channelId: firstChannelId,
        type: "channel",
        title,
        body,
      });
      const redis = (app as any).redis;
      if (redis) {
        await redis.publish(
          "chat:events",
          JSON.stringify({
            type: "notification:new",
            userId: target.id,
            notification: { id: nid, type: "channel", title, body, channelId: firstChannelId, workspaceId: id, messageId: null, createdAt: new Date().toISOString(), read: false },
          }),
        );
      }
    } catch (e) {
      console.warn("[workspaces] addMember notification failed", e);
    }
    return { id: target.id, name: target.name, email: target.email, role: parsed.data.role };
  });

  app.post("/api/workspaces/:id/invites", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const db = (app as any).db;
    const [member] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, id), eq(workspaceMember.userId, user.id)));
    if (!member || (member.role !== "owner" && member.role !== "admin")) return reply.code(403).send({ error: "Only owner/admin can invite" });
    const { invite } = await import("@chat/db/schema");
    const token = ulid() + ulid();
    const inviteId = ulid();
    const [inv] = await db
      .insert(invite)
      .values({
        id: inviteId,
        workspaceId: id,
        email: parsed.data.email,
        token,
        role: parsed.data.role,
        createdBy: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    // if the invited email belongs to an existing user, create an Activity notification so they see it in-app without waiting for email
    try {
      const [existing] = await db.select().from(userTable).where(eq(userTable.email, parsed.data.email));
      if (existing) {
        const { notification } = await import("@chat/db/schema");
        const [ws] = await db.select().from(workspace).where(eq(workspace.id, id));
        const chans = await db.select().from(channel).where(and(eq(channel.workspaceId, id), eq(channel.type, "public")));
        const firstChannelId = chans[0]?.id ?? null;
        const nid = ulid();
        const title = `${user.name} invited you to ${ws?.name ?? "a workspace"}`;
        const body = `Accept the invite to join ${ws?.name ?? id}. Invite: /invite/${token}`;
        await db.insert(notification).values({
          id: nid,
          userId: existing.id,
          workspaceId: id,
          channelId: firstChannelId,
          type: "channel",
          title,
          body,
        });
        const redis = (app as any).redis;
        if (redis) {
          await redis.publish(
            "chat:events",
            JSON.stringify({
              type: "notification:new",
              userId: existing.id,
              notification: { id: nid, type: "channel", title, body, channelId: firstChannelId, workspaceId: id, messageId: null, createdAt: new Date().toISOString(), read: false },
            }),
          );
        }
      }
    } catch (e) {
      console.warn("[workspaces] invite notification failed", e);
    }
    // In production send email; for dev return token
    return { ...inv, inviteUrl: `/invite/${token}` };
  });

  // find-or-create a direct-message channel between me and another workspace member
  app.post("/api/workspaces/:id/dm", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const parsed = createDmSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    if (parsed.data.userId === user.id) return reply.code(400).send({ error: "Cannot DM yourself" });
    const db = (app as any).db;

    const [isMember] = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, id), eq(workspaceMember.userId, user.id)));
    if (!isMember) return reply.code(403).send({ error: "Forbidden" });
    const [other] = await db.select().from(userTable).where(eq(userTable.id, parsed.data.userId));
    if (!other) return reply.code(404).send({ error: "User not found" });

    const pair = [user.id, other.id].sort().join(":");
    const name = `dm-${createHash("sha1").update(pair).digest("hex").slice(0, 12)}`;

    const [existing] = await db.select().from(channel).where(and(eq(channel.workspaceId, id), eq(channel.type, "dm"), eq(channel.name, name)));
    if (existing) {
      return { ...existing, dmPeer: { id: other.id, name: other.name }, created: false };
    }

    const chId = ulid();
    const [ch] = await db.insert(channel).values({ id: chId, workspaceId: id, name, type: "dm", createdBy: user.id }).returning();
    await db.insert(channelMember).values([
      { channelId: chId, userId: user.id },
      { channelId: chId, userId: other.id },
    ]).onConflictDoNothing();
    return { ...ch, dmPeer: { id: other.id, name: other.name }, created: true };
  });

  app.get("/api/invites/:token", async (req, reply) => {
    const { token } = req.params as any;
    const db = (app as any).db;
    const { invite } = await import("@chat/db/schema");
    const [inv] = await db.select().from(invite).where(eq(invite.token, token));
    if (!inv) return reply.code(404).send({ error: "Invite not found" });
    const [ws] = await db.select().from(workspace).where(eq(workspace.id, inv.workspaceId));
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });
    let alreadyMember = false;
    try {
      const viewer = await (app as any).getSessionUser(req);
      if (viewer) {
        const [mem] = await db
          .select()
          .from(workspaceMember)
          .where(and(eq(workspaceMember.workspaceId, inv.workspaceId), eq(workspaceMember.userId, viewer.id)));
        alreadyMember = !!mem;
      }
    } catch {}
    return {
      workspace: { id: ws.id, name: ws.name, slug: ws.slug },
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      isExpired: inv.expiresAt < new Date(),
      isAccepted: !!inv.acceptedAt,
      alreadyMember,
    };
  });

  app.post("/api/invites/:token/accept", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { token } = req.params as any;
    const db = (app as any).db;
    const { invite } = await import("@chat/db/schema");
    const [inv] = await db.select().from(invite).where(eq(invite.token, token));
    if (!inv) return reply.code(404).send({ error: "Invite not found" });
    if (inv.acceptedAt) return reply.code(400).send({ error: "Already accepted" });
    if (inv.expiresAt < new Date()) return reply.code(400).send({ error: "Expired" });
    // optional email check: if invite email != user email, still allow but log
    const existingMember = await db.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, inv.workspaceId), eq(workspaceMember.userId, user.id)));
    if (existingMember.length) return reply.code(400).send({ error: "Already member" });
    await db.insert(workspaceMember).values({ workspaceId: inv.workspaceId, userId: user.id, role: inv.role });
    // auto-join general/random
    const chans = await db.select().from(channel).where(eq(channel.workspaceId, inv.workspaceId));
    for (const c of chans) {
      await db.insert(channelMember).values({ channelId: c.id, userId: user.id }).onConflictDoNothing();
    }
    await db.update(invite).set({ acceptedAt: new Date() }).where(eq(invite.id, inv.id));
    return { ok: true, workspaceId: inv.workspaceId };
  });
}

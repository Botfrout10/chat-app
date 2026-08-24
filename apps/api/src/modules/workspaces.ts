import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { eq, and } from "drizzle-orm";
import { workspace, workspaceMember, channel, channelMember } from "@chat/db/schema";
import { createWorkspaceSchema, inviteSchema } from "@chat/shared/schemas";
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
      .innerJoin((await import("@chat/db/schema")).user, eq(workspaceMember.userId, (await import("@chat/db/schema")).user.id))
      .where(eq(workspaceMember.workspaceId, id));
    // drizzle join shape handling
    return rows.map((r: any) => ({ ...r.user, role: r.workspace_member.role, joinedAt: r.workspace_member.joinedAt }));
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
    // In production send email; for dev return token
    return { ...inv, inviteUrl: `${(app as any).server ? "" : ""}/invite/${token}` };
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

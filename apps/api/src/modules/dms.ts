import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { and, eq, inArray } from "drizzle-orm";
import { channel, channelMember, workspaceMember, user as userTable } from "@chat/db/schema";

export async function registerDmRoutes(app: FastifyInstance) {
  const db = () => (app as any).db;

  // Global DM list — all dm channels where user is member, across workspaces
  app.get("/api/dms", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const myMembers = await db().select().from(channelMember).where(eq(channelMember.userId, user.id));
    const myChannelIds = myMembers.map((r: any) => r.channelId);
    if (!myChannelIds.length) return [];

    const dmChannels = await db()
      .select()
      .from(channel)
      .where(and(eq(channel.type, "dm"), inArray(channel.id, myChannelIds as string[])));

    // attach peer info and lastRead
    const result: any[] = [];
    for (const ch of dmChannels as any[]) {
      // skip LLM bot DMs — those are AI models, not friends
      // bot emails end with @llm.local
      const members = await db()
        .select({ u: userTable, cm: channelMember })
        .from(channelMember)
        .innerJoin(userTable, eq(channelMember.userId, userTable.id))
        .where(eq(channelMember.channelId, ch.id));
      const peerRow = members.find((m: any) => m.u.id !== user.id);
      if (!peerRow) continue;
      // hide bot peers (LLM + agents) from friends list — they belong in AI MODELS / AGENTS
      const peerEmail = String(peerRow.u.email ?? "");
      if (peerEmail.endsWith("@llm.local") || peerEmail.endsWith("@agent.local")) continue;
      const myRow = members.find((m: any) => m.u.id === user.id);
      result.push({
        ...ch,
        dmPeer: { id: peerRow.u.id, name: peerRow.u.name, email: peerRow.u.email, image: peerRow.u.image },
        lastReadMessageId: (myRow as any)?.cm?.lastReadMessageId ?? null,
        peer: peerRow.u,
      });
    }
    // sort by createdAt desc for stable list
    result.sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));
    return result;
  });

  // Global DM creation — workspace-agnostic, finds peer by email (best), userId, or name
  // body: { userId?: string, email?: string, workspaceId?: string }
  app.post("/api/dms", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const body = req.body as any;
    const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
    const rawUserId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const rawWorkspaceId = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : "";
    const dbi = db();

    if (!rawEmail && !rawUserId) return reply.code(400).send({ error: "Provide userId or email" });
    if (rawUserId === user.id) return reply.code(400).send({ error: "Cannot DM yourself" });

    // find target: email exact is best (unique), then userId, then try email via search fallback
    let target: any = null;
    if (rawEmail) {
      const lower = rawEmail.toLowerCase();
      const [byEmail] = await dbi.select().from(userTable).where(eq(userTable.email, rawEmail));
      if (byEmail) target = byEmail;
      else {
        // case-insensitive fallback
        const { ilike } = await import("drizzle-orm");
        const rows = await dbi.select().from(userTable).where(ilike(userTable.email, lower)).limit(1);
        target = rows[0] ?? null;
      }
    }
    if (!target && rawUserId) {
      const [byId] = await dbi.select().from(userTable).where(eq(userTable.id, rawUserId));
      target = byId ?? null;
    }
    if (!target) return reply.code(404).send({ error: "User not found. Type exact email (e.g. alice@pulse.dev) as fallback.", code: "USER_NOT_FOUND" });

    if (target.id === user.id) return reply.code(400).send({ error: "Cannot DM yourself" });

    // check for existing DM with this peer in ANY workspace (global uniqueness per pair)
    const pair = [user.id, target.id].sort().join(":");
    const dmName = `dm-${createHash("sha1").update(pair).digest("hex").slice(0, 12)}`;
    const existingCandidates = await dbi.select().from(channel).where(and(eq(channel.type, "dm"), eq(channel.name, dmName)));
    for (const ch of existingCandidates as any[]) {
      const members = await dbi.select().from(channelMember).where(eq(channelMember.channelId, ch.id));
      const hasMe = members.some((m: any) => m.userId === user.id);
      const hasPeer = members.some((m: any) => m.userId === target.id);
      if (hasMe && hasPeer) {
        return { ...ch, dmPeer: { id: target.id, name: target.name, email: target.email }, created: false };
      }
    }

    // need workspace for storage (channel.workspaceId NOT NULL) — pick provided or first user workspace
    let workspaceId = rawWorkspaceId;
    if (!workspaceId) {
      const [wm] = await dbi.select().from(workspaceMember).where(eq(workspaceMember.userId, user.id)).limit(1);
      if (!wm) return reply.code(400).send({ error: "No workspace found. Create a workspace first." });
      workspaceId = wm.workspaceId;
    } else {
      const [isMember] = await dbi.select().from(workspaceMember).where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, user.id)));
      if (!isMember) return reply.code(403).send({ error: "Not a member of workspace" });
    }

    const chId = ulid();
    const [ch] = await dbi.insert(channel).values({ id: chId, workspaceId, name: dmName, type: "dm", createdBy: user.id }).returning();
    await dbi.insert(channelMember).values([
      { channelId: chId, userId: user.id },
      { channelId: chId, userId: target.id },
    ]).onConflictDoNothing();

    return { ...ch, dmPeer: { id: target.id, name: target.name, email: target.email }, created: true };
  });
}

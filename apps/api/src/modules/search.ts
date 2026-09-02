import type { FastifyInstance } from "fastify";
import { sql, and, eq } from "drizzle-orm";
import { message, channel, channelMember, workspaceMember } from "@chat/db/schema";
import { searchSchema } from "@chat/shared/schemas";
import { enforceRate } from "../lib/rateLimit.js";

export async function registerSearchRoutes(app: FastifyInstance) {
  // Full-text search using Postgres ilike for MVP (tsvector migration can be added later)
  app.get("/api/search", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "search", max: 60, windowMs: 60_000, subject: user.id }))) return;
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const { q, channelId } = parsed.data;
    const db = (app as any).db;
    // find channels user has access to
    const myChannels = await db.select().from(channelMember).where(eq(channelMember.userId, user.id));
    const myChannelIds = new Set(myChannels.map((c: any) => c.channelId));
    // also add public channels of workspaces user belongs to
    const wms = await db.select().from(workspaceMember).where(eq(workspaceMember.userId, user.id));
    const wsIds = wms.map((w: any) => w.workspaceId);
    let publicChannels: any[] = [];
    if (wsIds.length) {
      const { inArray } = await import("drizzle-orm");
      publicChannels = await db.select().from(channel).where(and(eq(channel.type, "public" as any), inArray(channel.workspaceId, wsIds as string[])));
      for (const pc of publicChannels) myChannelIds.add(pc.id);
    }
    if (myChannelIds.size === 0) return [];

    const { inArray } = await import("drizzle-orm");
    // tsvector search with fallback to ilike if tsvector column not yet populated
    const idsForFilter = channelId
      ? [channelId]
      : Array.from(myChannelIds) as string[];
    if (!idsForFilter.length) return [];
    if (channelId && !myChannelIds.has(channelId)) return reply.code(403).send({ error: "Forbidden channel" });

    // try tsvector first, fallback to ilike on error
    let rows: any[] = [];
    try {
      const tsQuery = sql`plainto_tsquery('english', ${q})`;
      const rank = sql`ts_rank(CAST(${message.searchVector} AS tsvector), ${tsQuery})`;
      const whereTs = and(
        sql`CAST(${message.searchVector} AS tsvector) @@ ${tsQuery}`,
        inArray(message.channelId, idsForFilter),
      );
      // ensure deleted messages not returned
      const whereWithDeleted = and(whereTs, sql`${message.deletedAt} IS NULL`);
      rows = await db
        .select({ message, channel, rank })
        .from(message)
        .innerJoin(channel, eq(message.channelId, channel.id))
        .where(whereWithDeleted as any)
        .orderBy(sql`${rank} DESC, ${message.createdAt} DESC`)
        .limit(50);
      // if tsvector had no hits (e.g. stopwords), fallback to ilike for recall
      if (rows.length === 0) throw new Error("no tsvector hits");
    } catch {
      const { ilike } = await import("drizzle-orm");
      let whereClause: any = ilike(message.content, `%${q}%`);
      whereClause = and(whereClause, inArray(message.channelId, idsForFilter), sql`${message.deletedAt} IS NULL`);
      rows = await db
        .select({ message, channel, rank: sql`0`.as("rank") })
        .from(message)
        .innerJoin(channel, eq(message.channelId, channel.id))
        .where(whereClause)
        .orderBy(sql`${message.createdAt} DESC`)
        .limit(50);
    }

    return rows.map((r: any) => ({ ...r.message, channel: r.channel }));
  });
}

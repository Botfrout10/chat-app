import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { notification } from "@chat/db/schema";

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.get("/api/notifications", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const db = (app as any).db;
    const items = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, user.id))
      .orderBy(desc(notification.createdAt))
      .limit(50);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notification)
      .where(and(eq(notification.userId, user.id), eq(notification.read, false)));
    return { items, unread: count };
  });

  app.post("/api/notifications/:id/read", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { id } = req.params as any;
    const db = (app as any).db;
    await db.update(notification).set({ read: true }).where(and(eq(notification.id, id), eq(notification.userId, user.id)));
    return { ok: true };
  });

  app.post("/api/notifications/read-all", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const db = (app as any).db;
    await db.update(notification).set({ read: true }).where(eq(notification.userId, user.id));
    return { ok: true };
  });
}

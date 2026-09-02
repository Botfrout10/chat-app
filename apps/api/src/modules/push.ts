import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { eq } from "drizzle-orm";
import { pushToken } from "@chat/db/schema";
import { registerPushTokenSchema } from "@chat/shared/schemas";
import { enforceRate } from "../lib/rateLimit.js";

export async function registerPushRoutes(app: FastifyInstance) {
  // register / upsert token
  app.post("/api/push/register", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "push-register", max: 30, windowMs: 60_000, subject: user.id }))) return;
    const parsed = registerPushTokenSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const db = (app as any).db;
    const { token, platform } = parsed.data;
    // upsert: if token exists for another user, reassign to current user
    const [existing] = await db.select().from(pushToken).where(eq(pushToken.token, token));
    if (existing) {
      if (existing.userId !== user.id) {
        await db.update(pushToken).set({ userId: user.id, platform, lastUsedAt: new Date() }).where(eq(pushToken.token, token));
      } else {
        await db.update(pushToken).set({ platform, lastUsedAt: new Date() }).where(eq(pushToken.token, token));
      }
      return { ok: true, id: existing.id };
    }
    const id = ulid();
    await db.insert(pushToken).values({ id, userId: user.id, token, platform });
    return { ok: true, id };
  });

  app.delete("/api/push/token", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { token } = req.body as any;
    if (!token || typeof token !== "string") return reply.code(400).send({ error: "token required" });
    const db = (app as any).db;
    await db.delete(pushToken).where(eq(pushToken.token, token));
    return { ok: true };
  });

  // dev helper: test push (sends to own tokens)
  app.post("/api/push/test", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const db = (app as any).db;
    const rows = await db.select().from(pushToken).where(eq(pushToken.userId, user.id));
    return { count: rows.length, tokens: rows.map((r: any) => r.token.slice(0, 30) + "...") };
  });
}

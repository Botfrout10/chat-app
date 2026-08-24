import type { FastifyInstance } from "fastify";

export async function registerUserRoutes(app: FastifyInstance) {
  app.get("/api/users/me", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    return user;
  });

  app.get("/api/users/search", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const q = (req.query as any)?.q as string | undefined;
    const db = (app as any).db;
    // simple user search by name/email for mentions/invites
    const { user: userTable } = await import("@chat/db/schema");
    const { ilike, or } = await import("drizzle-orm");
    if (!q) return [];
    const rows = await db.select().from(userTable).where(or(ilike(userTable.name, `%${q}%`), ilike(userTable.email, `%${q}%`))).limit(10);
    return rows.map((u: any) => ({ id: u.id, name: u.name, email: u.email, image: u.image }));
  });
}

import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { presignPut, presignGet } from "../lib/s3.js";
import { presignSchema } from "@chat/shared/schemas";
import { enforceRate } from "../lib/rateLimit.js";

export async function registerAttachmentRoutes(app: FastifyInstance) {
  app.post("/api/attachments/presign", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "presign", max: 20, windowMs: 60_000, subject: user.id }))) return;
    const parsed = presignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const { filename, mime, size } = parsed.data;
    const s3 = (app as any).s3;
    const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
    const key = `attachments/${new Date().toISOString().slice(0, 10)}/${ulid()}.${ext}`;
    // sanitize filename in key but keep original for metadata
    const url = await presignPut(s3, key, mime);
    return { url, key, filename, mime, size, bucket: process.env.S3_BUCKET ?? "chat-attachments" };
  });

  app.get("/api/attachments/:key/signed", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { key } = req.params as any;
    const decodedKey = decodeURIComponent(key);
    const s3 = (app as any).s3;
    const url = await presignGet(s3, decodedKey);
    return { url };
  });
}

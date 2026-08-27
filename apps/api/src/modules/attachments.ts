import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { presignPut, presignGet } from "../lib/s3.js";
import { presignSchema } from "@chat/shared/schemas";
import { enforceRate } from "../lib/rateLimit.js";
import { env } from "../lib/env.js";

function s3EndpointForRequest(req: any): string | null {
  try {
    const hostHeader = String(req.headers.host ?? req.headers["x-forwarded-host"] ?? "");
    const host = hostHeader.split(",")[0].trim().split(":")[0];
    if (!host || host === "localhost" || host === "127.0.0.1") return null; // use default localhost
    // only trust LAN / emulator hosts — avoid SSRF via arbitrary Host header
    if (/^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host)) {
      return `http://${host}:9000`;
    }
    if (host === "10.0.2.2") return `http://${host}:9000`;
    return null;
  } catch {
    return null;
  }
}

function s3ForRequest(req: any, base: S3Client): S3Client {
  const ep = s3EndpointForRequest(req);
  if (!ep) return base;
  return new S3Client({
    region: env.S3_REGION,
    endpoint: ep,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
}

export async function registerAttachmentRoutes(app: FastifyInstance) {
  app.post("/api/attachments/presign", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "presign", max: 20, windowMs: 60_000, subject: user.id }))) return;
    const parsed = presignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(parsed.error.flatten());
    const { filename, mime, size } = parsed.data;
    const baseS3 = (app as any).s3 as S3Client;
    const s3 = s3ForRequest(req as any, baseS3);
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
    const baseS3 = (app as any).s3 as S3Client;
    const s3 = s3ForRequest(req as any, baseS3);
    const url = await presignGet(s3, decodedKey);
    return { url };
  });

  // Proxied GET for clients that cannot use presigned MinIO URLs directly
  // (Android emulator: localhost presigned signature breaks after host rewrite).
  // Auth is via cookie, Authorization header, or ?token= query (for <Image>).
  // Streams the object through the API so it is reachable via API_URL (10.0.2.2).
  app.get("/api/attachments/:key/raw", async (req, reply) => {
    const user = await (app as any).getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    if (!(await enforceRate(app.redis, req, reply, { name: "attachment-raw", max: 120, windowMs: 60_000, subject: user.id }))) return;
    const { key } = req.params as any;
    const decodedKey = decodeURIComponent(key);
    const s3 = (app as any).s3;
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: decodedKey }));
      const ct = (res.ContentType as string) ?? "application/octet-stream";
      const len = res.ContentLength as number | undefined;
      const etag = res.ETag as string | undefined;
      if (ct) reply.header("content-type", ct);
      if (len) reply.header("content-length", String(len));
      if (etag) reply.header("etag", etag);
      reply.header("cache-control", "private, max-age=3600");
      reply.header("content-disposition", `inline; filename="${encodeURIComponent(decodedKey.split("/").pop() ?? "file")}"`);
      reply.header("access-control-allow-origin", "*");
      if (!res.Body) return reply.code(404).send({ error: "Not found" });
      // @aws-sdk Body is a readable stream / Uint8Array / Blob
      const body: any = res.Body;
      if (typeof body.pipe === "function") return reply.send(body);
      if (body.transformToByteArray) {
        const bytes = await body.transformToByteArray();
        return reply.send(Buffer.from(bytes));
      }
      return reply.send(body);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("NoSuchKey") || msg.includes("NotFound")) return reply.code(404).send({ error: "Not found" });
      req.log.error(`attachment raw fetch failed for ${decodedKey}: ${msg}`);
      return reply.code(500).send({ error: "Failed to fetch attachment" });
    }
  });
}

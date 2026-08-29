import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { Server as IOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "./lib/env.js";
import { createAuth } from "./lib/auth.js";
import { getDb } from "@chat/db";
import { createRedis } from "./lib/redis.js";
import { createS3 } from "./lib/s3.js";
import { registerWorkspaceRoutes } from "./modules/workspaces.js";
import { registerChannelRoutes } from "./modules/channels.js";
import { registerDmRoutes } from "./modules/dms.js";
import { registerMessageRoutes } from "./modules/messages.js";
import { registerAttachmentRoutes } from "./modules/attachments.js";
import { registerSearchRoutes } from "./modules/search.js";
import { registerUserRoutes } from "./modules/users.js";
import { registerNotificationRoutes } from "./modules/notifications.js";
import { registerLlmRoutes } from "./modules/llm.js";
import { setupSocket } from "./modules/socket.js";
import { startNotificationWorker, stopNotificationWorker } from "./workers/notifications.js";
import { closeQueue } from "./lib/queue.js";
import { enforceRate, registerRateLimitCommands } from "./lib/rateLimit.js";

const app = Fastify({ logger: true });

const allowedOrigins = [env.WEB_URL, "http://localhost:3000", ...env.EXTRA_ORIGINS];

await app.register(cors, {
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
});

await app.register(cookie);

const auth = createAuth();
const db = getDb(env.DATABASE_URL);
const redis = createRedis();
const redisSub = redis.duplicate();
const s3 = createS3();

// health
app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

// better-auth handler: mount at /api/auth/*
// better-auth expects to handle requests itself; we proxy via fastify
app.all("/api/auth/*", async (req, reply) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const body = req.method !== "GET" && req.method !== "HEAD" ? (req.body as any) : undefined;
  const bodyText = body ? JSON.stringify(body) : undefined;
  if (bodyText) headers.set("content-type", "application/json");

  // React Native fetch sends no Origin header; better-auth's CSRF check then
  // rejects the request with 403 "Missing or null origin". Native clients
  // authenticate via bearer tokens (no cookies), so CSRF doesn't apply to
  // them — supply a trusted origin so the check passes.
  if (!headers.has("origin")) headers.set("origin", env.API_URL);

  const request = new Request(url.toString(), {
    method: req.method,
    headers,
    body: bodyText,
  });

  const res = await auth.handler(request);
  reply.status(res.status);
  for (const [k, v] of res.headers.entries()) reply.header(k, v);
  const text = await res.text();
  return reply.send(text);
});

// helper to get session user — supports cookie (web), bearer header (mobile fetch),
// and ?token= query (mobile <Image> / downloadAsync where headers are stripped on Android).
// We try header/cookie first, then fall back to query token even if a (potentially stale)
// header was present, so a single bad header doesn't mask a good query token.
async function getSessionUser(req: any) {
  const trySession = async (h: Headers) => {
    try {
      const s = await auth.api.getSession({ headers: h });
      return s;
    } catch {
      return null;
    }
  };

  // 1) cookie + Authorization header (web + mobile fetch)
  const h1 = new Headers();
  if (req.headers.cookie) h1.set("cookie", req.headers.cookie as string);
  if (req.headers.authorization) h1.set("authorization", req.headers.authorization as string);
  let session = await trySession(h1);
  if (session?.user) return session.user;

  // 2) ?token= query (Image / downloadAsync fallback) — try even if header existed but failed
  let qToken: string | null = null;
  if (req.query?.token) qToken = String(req.query.token);
  else if (req.url?.includes("token=")) {
    try {
      const u = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      qToken = u.searchParams.get("token");
    } catch {}
  }
  if (qToken) {
    const h2 = new Headers();
    if (req.headers.cookie) h2.set("cookie", req.headers.cookie as string);
    h2.set("authorization", `Bearer ${qToken}`);
    session = await trySession(h2);
    if (session?.user) return session.user;
  }

  return null;
}

// decorate
app.decorate("auth", auth);
app.decorate("db", db);
app.decorate("redis", redis);
app.decorate("s3", s3);
app.decorate("getSessionUser", getSessionUser);

// global per-IP rate guard for /api/* (auth routes excluded — better-auth has its own)
registerRateLimitCommands(redis);
app.addHook("onRequest", async (req, reply) => {
  if (req.method === "OPTIONS") return;
  const url = req.url.split("?")[0];
  if (!url.startsWith("/api/") || url.startsWith("/api/auth/")) return;
  const ok = await enforceRate(redis, req, reply, { name: "global-ip", max: 600, windowMs: 60_000, subject: req.ip });
  if (!ok) return reply;
});

// routes
await registerUserRoutes(app);
await registerWorkspaceRoutes(app);
await registerChannelRoutes(app);
await registerDmRoutes(app);
await registerMessageRoutes(app);
await registerAttachmentRoutes(app);
await registerSearchRoutes(app);
await registerNotificationRoutes(app);
await registerLlmRoutes(app);

// 404
app.setNotFoundHandler((_, reply) => reply.code(404).send({ error: "Not found" }));

// start http + socket.io
await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(`API listening on ${env.HOST}:${env.PORT}`);

// Socket.IO on same http server
const io = new IOServer(app.server, {
  cors: { origin: allowedOrigins, credentials: true },
  path: "/socket.io",
});

const pubClient = redis;
const subClient = redisSub;
io.adapter(createAdapter(pubClient, subClient));

setupSocket(io, { db, redis, auth });

startNotificationWorker();

app.log.info("Socket.IO ready with Redis adapter");

// graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    app.log.info(`Received ${sig}, closing`);
    await stopNotificationWorker();
    await closeQueue();
    await io.close();
    await app.close();
    redis.disconnect();
    redisSub.disconnect();
    process.exit(0);
  });
}

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

await app.register(cors, {
  origin: [env.WEB_URL, "http://localhost:3000"],
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

// helper to get session user
async function getSessionUser(req: any) {
  const headers = new Headers();
  if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
  if (req.headers.authorization) headers.set("authorization", req.headers.authorization as string);
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
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
  cors: { origin: [env.WEB_URL, "http://localhost:3000"], credentials: true },
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

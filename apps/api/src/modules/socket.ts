import type { Server } from "socket.io";
import type { Db } from "@chat/db";
import type { Redis } from "../lib/redis.js";
import type { Auth } from "../lib/auth.js";

export function setupSocket(io: Server, deps: { db: Db; redis: Redis; auth: Auth }) {
  const { redis, auth } = deps;

  // authenticate socket via better-auth cookie / token
  io.use(async (socket, next) => {
    try {
      const cookie = socket.handshake.headers.cookie;
      const authHeader = socket.handshake.headers.authorization as string | undefined;
      const headers = new Headers();
      if (cookie) headers.set("cookie", cookie);
      if (authHeader) headers.set("authorization", authHeader);
      // also allow token via auth payload
      const token = (socket.handshake.auth as any)?.token as string | undefined;
      if (token) headers.set("authorization", `Bearer ${token}`);

      const session = await auth.api.getSession({ headers });
      if (!session?.user) return next(new Error("Unauthorized"));
      (socket.data as any).user = session.user;
      return next();
    } catch (e) {
      return next(new Error("Auth failed"));
    }
  });

  // subscribe to redis events for cross-server fanout fallback
  const sub = redis.duplicate();
  sub.subscribe("chat:events");
  sub.on("message", (channel, msg) => {
    if (channel !== "chat:events") return;
    try {
      const evt = JSON.parse(msg);
      if (evt.type === "message:new") {
        io.to(`channel:${evt.channelId}`).emit("message:new", evt.message);
        io.to(`channel:${evt.channelId}`).emit("message", evt.message); // alias
      } else if (evt.type === "message:updated") {
        io.to(`channel:${evt.channelId}`).emit("message:updated", evt.message);
      } else if (evt.type === "message:deleted") {
        io.to(`channel:${evt.channelId}`).emit("message:deleted", { messageId: evt.messageId, channelId: evt.channelId });
      } else if (evt.type === "reaction:update") {
        io.to(`channel:${evt.channelId}`).emit("reaction:update", evt);
      } else if (evt.type === "read:receipt") {
        io.to(`channel:${evt.channelId}`).emit("read:receipt", evt);
      } else if (evt.type === "notification:new") {
        io.to(`user:${evt.userId}`).emit("notification:new", evt.notification);
      } else if (evt.type === "llm:delta" || evt.type === "llm:thinking" || evt.type === "llm:typing" || evt.type === "llm:error") {
        io.to(`channel:${evt.channelId}`).emit(evt.type, evt);
      }
    } catch {}
  });

  io.on("connection", (socket) => {
    const user = (socket.data as any).user;
    // personal room for direct events (notifications etc.)
    socket.join(`user:${user.id}`);
    // console.log(`socket connected ${socket.id} user ${user.id}`);

    // presence: set online
    redis.hset("presence", user.id, JSON.stringify({ status: "online", lastSeen: new Date().toISOString(), userId: user.id }));
    redis.expire("presence", 3600);
    io.emit("presence:update", { userId: user.id, status: "online" });

    socket.on("join:channel", (channelId: string) => {
      socket.join(`channel:${channelId}`);
    });

    socket.on("leave:channel", (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    socket.on("typing:start", ({ channelId }: { channelId: string }) => {
      socket.to(`channel:${channelId}`).emit("typing:update", { channelId, userId: user.id, isTyping: true });
      // auto-expire typing after 3s via redis key
      redis.setex(`typing:${channelId}:${user.id}`, 4, "1");
    });

    socket.on("typing:stop", ({ channelId }: { channelId: string }) => {
      socket.to(`channel:${channelId}`).emit("typing:update", { channelId, userId: user.id, isTyping: false });
      redis.del(`typing:${channelId}:${user.id}`);
    });

    socket.on("presence:update", ({ status }: { status: string }) => {
      const s = ["online", "offline", "away"].includes(status) ? status : "online";
      redis.hset("presence", user.id, JSON.stringify({ status: s, lastSeen: new Date().toISOString(), userId: user.id }));
      io.emit("presence:update", { userId: user.id, status: s });
    });

    socket.on("disconnect", () => {
      // keep presence as offline after disconnect with delay? immediate for MVP
      redis.hset("presence", user.id, JSON.stringify({ status: "offline", lastSeen: new Date().toISOString(), userId: user.id }));
      io.emit("presence:update", { userId: user.id, status: "offline" });
    });
  });

  // periodic cleanup: emit presence list on request
  io.on("connection", (socket) => {
    socket.on("presence:list", async () => {
      const all = await redis.hgetall("presence");
      const list = Object.values(all).map((v) => {
        try { return JSON.parse(v); } catch { return null; }
      }).filter(Boolean);
      socket.emit("presence:list", list);
    });
  });
}

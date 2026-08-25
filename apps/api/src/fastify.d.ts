import type { Auth } from "./lib/auth.js";
import type { Redis } from "./lib/redis.js";
import type { Db } from "@chat/db";
import type { FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    auth: Auth;
    db: Db;
    redis: Redis;
    s3: any;
    getSessionUser: (req: FastifyRequest) => Promise<{ id: string; email: string; name: string } | null>;
  }
}

export {};

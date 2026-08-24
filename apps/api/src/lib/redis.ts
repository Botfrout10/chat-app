import IORedis from "ioredis";
import { env } from "./env.js";

export function createRedis() {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export type Redis = ReturnType<typeof createRedis>;

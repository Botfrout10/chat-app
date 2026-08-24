import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env.js";

let _queue: Queue | null = null;
let _conn: IORedis | null = null;

export function getNotificationQueue(): Queue {
  if (_queue) return _queue;
  _conn = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  _queue = new Queue("notifications", {
    connection: _conn,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 200,
      removeOnFail: 1000,
    },
  });
  return _queue;
}

export async function closeQueue() {
  if (_queue) await _queue.close();
  if (_conn) _conn.disconnect();
  _queue = null;
  _conn = null;
}

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

let _agentQueue: Queue | null = null;
let _agentConn: IORedis | null = null;

export function getAgentQueue(): Queue {
  if (_agentQueue) return _agentQueue;
  _agentConn = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  _agentQueue = new Queue("agent-prompts", {
    connection: _agentConn,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });
  return _agentQueue;
}

export async function closeAgentQueue() {
  if (_agentQueue) await _agentQueue.close();
  if (_agentConn) _agentConn.disconnect();
  _agentQueue = null;
  _agentConn = null;
}

export async function closeQueue() {
  if (_queue) await _queue.close();
  if (_conn) _conn.disconnect();
  _queue = null;
  _conn = null;
  await closeAgentQueue();
}

import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { getDb } from "@chat/db";
import { env } from "../lib/env.js";
import { triggerAgentReplyInternal } from "../lib/agent.js";

type AgentJobData = {
  agentId: string;
  channelId: string;
  sessionId?: string | null;
  promptMessageId: string;
};

let _worker: Worker | null = null;

export function startAgentWorker(app: any): Worker {
  if (_worker) return _worker;
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  _worker = new Worker<AgentJobData>(
    "agent-prompts",
    async (job: Job<AgentJobData>) => {
      const { agentId, channelId, sessionId, promptMessageId } = job.data;
      const db = getDb(env.DATABASE_URL);
      const { agentRegistration } = await import("@chat/db/schema");
      const { eq } = await import("drizzle-orm");
      const [agent] = await db.select().from(agentRegistration).where(eq(agentRegistration.id, agentId));
      if (!agent) throw new Error("Agent not found");
      // attach sessionId to job context via app transient?
      // trigger internal will handle sessionId if provided
      await triggerAgentReplyInternal(app, { agent, channelId, promptMessageId, sessionId });
    },
    {
      connection,
      concurrency: 5,
      limiter: { max: 10, duration: 1000 },
    },
  );
  _worker.on("completed", (job) => console.log(`[agent] job ${job.id} done`));
  _worker.on("failed", (job, err) => console.error(`[agent] job ${job?.id} failed: ${err.message}`));
  console.log("[agent] worker started");
  return _worker;
}

export async function stopAgentWorker() {
  if (_worker) await _worker.close();
  _worker = null;
}

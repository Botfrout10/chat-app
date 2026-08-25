import type { FastifyReply, FastifyRequest } from "fastify";

const SLIDING_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryMs = window - (now - tonumber(oldest[2]))
return {0, math.max(1, math.ceil(retryMs / 1000))}
`;

export function registerRateLimitCommands(redis: any) {
  if (typeof redis.slidingWindow === "function") return;
  redis.defineCommand("slidingWindow", {
    numberOfKeys: 1,
    lua: SLIDING_LUA,
  });
}

export type RateOptions = {
  name: string;
  max: number;
  windowMs: number;
  subject: string;
};

// Returns true if allowed; otherwise sends 429 with headers.
export async function enforceRate(
  redis: any,
  req: FastifyRequest,
  reply: FastifyReply,
  opts: RateOptions
): Promise<boolean> {
  registerRateLimitCommands(redis);
  const key = `rl:${opts.name}:${opts.subject}`;
  const member = `${Date.now()}-${req.id}-${Math.random().toString(36).slice(2, 8)}`;
  const [allowedRaw, infoRaw] = (await redis.slidingWindow(key, Date.now(), opts.windowMs, opts.max, member)) as number[];
  const allowed = Number(allowedRaw) === 1;
  const info = Number(infoRaw);
  reply.header("X-RateLimit-Limit", opts.max);
  if (allowed) {
    reply.header("X-RateLimit-Remaining", info);
    return true;
  }
  reply.header("X-RateLimit-Remaining", 0);
  reply.header("Retry-After", info);
  reply.code(429).send({ error: `Rate limit exceeded for ${opts.name}`, retryAfterSeconds: info });
  return false;
}

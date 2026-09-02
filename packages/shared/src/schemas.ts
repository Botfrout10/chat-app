import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(50),
});

export const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

export const addMemberSchema = z.object({
  user: z.string().min(1).max(120),
  role: z.enum(["admin", "member"]).default("member"),
});

export const createDmSchema = z.object({
  userId: z.string().min(1).max(64),
});

export const createChannelSchema = z.object({
  name: z.string().min(2).max(50).regex(/^[a-z0-9-_]+$/, "lowercase letters, numbers, - _ only"),
  type: z.enum(["public", "private", "group", "dm"]).default("public"),
  memberIds: z.array(z.string()).optional(),
});

export const attachmentMetaSchema = z.object({
  key: z.string().min(1).max(512),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(127),
  size: z.number().int().min(0).max(25 * 1024 * 1024),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  parentId: z.string().optional().nullable(),
  attachments: z.array(attachmentMetaSchema).max(10).optional(),
  nonce: z.string().optional(), // idempotency
});

export const editMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(10),
});

export const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(127),
  size: z.number().int().positive().max(25 * 1024 * 1024),
});

export const paginationSchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const searchSchema = z.object({
  q: z.string().min(1).max(100),
  channelId: z.string().optional(),
});

export const createLlmConnectionSchema = z.object({
  label: z.string().min(1).max(80),
  baseUrl: z.string().url().max(500),
  modelId: z.string().min(1).max(200),
  provider: z.enum(["openai-compatible", "anthropic"]).default("openai-compatible").optional(),
  // @token used to mention the model; defaults to slugified label
  mentionName: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/).optional(),
  // OpenAI-compatible bearer token for cloud providers (e.g. OpenAI, Groq, OpenRouter)
  // sent server-side only; never returned in GET responses
  apiKey: z.string().min(1).max(500).optional(),
});

export const updateLlmConnectionSchema = createLlmConnectionSchema.partial();

export const agentStatusEnum = z.enum(["pending", "online", "offline", "error"]);
export type AgentStatus = z.infer<typeof agentStatusEnum>;

export const createAgentRegistrationSchema = z
  .object({
    name: z.string().min(1).max(80),
    workspaceId: z.string().min(1).max(64),
    transport: z.enum(["network", "stdio"]).default("network"),
    endpoint: z.string().url().max(500).optional(),
    authSecret: z.string().min(1).max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.transport === "network" && !data.endpoint) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endpoint is required for network transport", path: ["endpoint"] });
    }
  });

export const updateAgentRegistrationSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    workspaceId: z.string().min(1).max(64).optional(),
    transport: z.enum(["network", "stdio"]).optional(),
    endpoint: z.string().url().max(500).optional().nullable(),
    authSecret: z.string().min(1).max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.transport === "network" && data.endpoint !== undefined && !data.endpoint) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endpoint is required for network transport", path: ["endpoint"] });
    }
  });

export const registerPushTokenSchema = z.object({
  token: z.string().min(10).max(300).regex(/^ExponentPushToken\[[^\]]+\]$/),
  platform: z.enum(["ios", "android"]),
});

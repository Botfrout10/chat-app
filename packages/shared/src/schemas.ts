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

export const createChannelSchema = z.object({
  name: z.string().min(2).max(50).regex(/^[a-z0-9-_]+$/, "lowercase letters, numbers, - _ only"),
  type: z.enum(["public", "private", "group", "dm"]).default("public"),
  memberIds: z.array(z.string()).optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  parentId: z.string().optional().nullable(),
  attachmentKeys: z.array(z.string()).max(10).optional(),
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

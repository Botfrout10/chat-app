import { ulid } from "ulid";

export function newId(): string {
  return ulid();
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_CHANNEL_NAME_LENGTH = 50;

export type CursorPagination = {
  before?: string;
  after?: string;
  limit?: number;
};

export function parsePagination(query: Record<string, unknown>) {
  const limitRaw = Number(query.limit ?? 50);
  const limit = Math.min(Math.max(limitRaw, 1), 100);
  const before = typeof query.before === "string" ? query.before : undefined;
  const after = typeof query.after === "string" ? query.after : undefined;
  return { limit, before, after } as const;
}

export const WS_EVENTS = {
  MESSAGE_NEW: "message:new",
  MESSAGE_UPDATED: "message:updated",
  MESSAGE_DELETED: "message:deleted",
  TYPING_START: "typing:start",
  TYPING_STOP: "typing:stop",
  TYPING_UPDATE: "typing:update",
  PRESENCE_UPDATE: "presence:update",
  READ_RECEIPT: "read:receipt",
  REACTION_UPDATE: "reaction:update",
} as const;

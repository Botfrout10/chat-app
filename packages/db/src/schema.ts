import { pgTable, text, timestamp, varchar, index, unique, primaryKey, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Better-auth tables (compatible with better-auth drizzle adapter)
export const user = pgTable("user", {
  id: text("id").primaryKey(), // ulid
  name: text("name").notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 512 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("session_user_idx").on(t.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  issuer: text("issuer"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// App tables
export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  ownerId: text("owner_id").notNull().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMember = pgTable("workspace_member", {
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull().$type<"owner" | "admin" | "member">(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("wm_user_idx").on(t.userId)]);

export const channel = pgTable("channel", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 50 }).notNull(),
  type: varchar("type", { length: 20 }).notNull().$type<"public" | "private" | "dm" | "group">(),
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("channel_ws_idx").on(t.workspaceId), unique("channel_ws_name_unique").on(t.workspaceId, t.name)]);

export const channelMember = pgTable("channel_member", {
  channelId: text("channel_id").notNull().references(() => channel.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  lastReadMessageId: text("last_read_message_id"),
  notificationPref: varchar("notification_pref", { length: 20 }).notNull().default("all").$type<"all" | "mentions" | "nothing">(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.channelId, t.userId] })]);

export const message = pgTable("message", {
  id: text("id").primaryKey(), // ULID time-ordered
  channelId: text("channel_id").notNull().references(() => channel.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull().references(() => user.id),
  parentId: text("parent_id").references((): any => message.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  // chain-of-thought / thinking output from reasoning models (AI messages)
  reasoning: text("reasoning"),
  nonce: varchar("nonce", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("message_channel_id_idx").on(t.channelId, t.id),
  index("message_parent_idx").on(t.parentId),
  index("message_nonce_idx").on(t.channelId, t.nonce),
  // for FTS we create index via sql migration
]);

export const attachment = pgTable("attachment", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => message.id, { onDelete: "cascade" }),
  key: text("key").notNull().unique(),
  filename: varchar("filename", { length: 255 }).notNull(),
  mime: varchar("mime", { length: 127 }).notNull(),
  size: integer("size").notNull(),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("attachment_message_idx").on(t.messageId)]);

export const reaction = pgTable("reaction", {
  messageId: text("message_id").notNull().references(() => message.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  emoji: varchar("emoji", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })]);

export const mention = pgTable("mention", {
  messageId: text("message_id").notNull().references(() => message.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channel.id, { onDelete: "cascade" }),
  mentionedUserId: text("mentioned_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull().references(() => user.id),
  type: varchar("type", { length: 10 }).notNull().default("user").$type<"user" | "llm">(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.messageId, t.mentionedUserId] }),
  index("mention_user_idx").on(t.mentionedUserId, t.createdAt),
]);

export const invite = pgTable("invite", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  role: varchar("role", { length: 20 }).notNull().$type<"admin" | "member">(),
  createdBy: text("created_by").notNull().references(() => user.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("invite_token_idx").on(t.token), index("invite_email_idx").on(t.email)]);

export const notification = pgTable("notification", {  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "cascade" }),
  channelId: text("channel_id").references(() => channel.id, { onDelete: "cascade" }),
  messageId: text("message_id"),
  type: varchar("type", { length: 20 }).notNull().$type<"mention" | "dm" | "thread" | "channel">(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("notification_user_idx").on(t.userId, t.createdAt)]);

// AI integrations (Phase A — personal LLM connections)
export const llmConnection = pgTable("llm_connection", {
  id: text("id").primaryKey(), // ulid
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  // synthetic user that authors the model's replies (email llm+<id>@llm.local);
  // makes AI messages ordinary message rows with working joins
  botUserId: text("bot_user_id").references(() => user.id, { onDelete: "set null" }),
  label: varchar("label", { length: 80 }).notNull(),
  mentionName: varchar("mention_name", { length: 80 }).notNull(), // @token matched in message content
  provider: varchar("provider", { length: 40 }).notNull().default("openai-compatible").$type<"openai-compatible" | "anthropic">(),
  baseUrl: text("base_url").notNull(), // OpenAI-compatible base incl. version path, e.g. http://localhost:1234/v1
  modelId: text("model_id").notNull(), // model name as reported by the provider
  apiKeyEncrypted: text("api_key_encrypted"), // AES-GCM encrypted bearer token (cloud providers); null for local
  status: varchar("status", { length: 20 }).notNull().default("unverified").$type<"unverified" | "ok" | "error">(),
  lastError: text("last_error"),
  capabilities: jsonb("capabilities"), // provider-reported extras (context length, tools, vision…)
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("llm_owner_mention_unique").on(t.ownerId, t.mentionName),
  index("llm_owner_idx").on(t.ownerId),
]);

// AI integrations (Phase B — external agents over ACP)
export const agentRegistration = pgTable("agent_registration", {
  id: text("id").primaryKey(), // ulid
  ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  // each connected agent is bound to exactly one workspace in the app,
  // matching the machine the agent runs on (its tasks map to ACP sessions)
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(), // human label shown in sidebar
  transport: varchar("transport", { length: 20 }).notNull().default("network").$type<"network" | "stdio">(),
  endpoint: text("endpoint"), // ws(s)/http URL for the networked ACP transport
  authSecret: text("auth_secret"), // ACP auth token; encryption-at-rest deferred to Phase C
  status: varchar("status", { length: 20 }).notNull().default("pending").$type<"pending" | "online" | "offline" | "error">(),
  capabilities: jsonb("capabilities"), // handshake-reported: agent name/version, tools…
  machineMetadata: jsonb("machine_metadata"), // os, hostname, arch…
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_owner_idx").on(t.ownerId),
  index("agent_workspace_idx").on(t.workspaceId),
]);

// Relations
export const workspaceRelations = relations(workspace, ({ many, one }) => ({
  members: many(workspaceMember),
  channels: many(channel),
  owner: one(user, { fields: [workspace.ownerId], references: [user.id] }),
}));

export const messageRelations = relations(message, ({ one, many }) => ({
  sender: one(user, { fields: [message.senderId], references: [user.id] }),
  channel: one(channel, { fields: [message.channelId], references: [channel.id] }),
  parent: one(message, { fields: [message.parentId], references: [message.id], relationName: "thread" }),
  replies: many(message, { relationName: "thread" }),
  attachments: many(attachment),
  reactions: many(reaction),
}));

export const agentRegistrationRelations = relations(agentRegistration, ({ one }) => ({
  owner: one(user, { fields: [agentRegistration.ownerId], references: [user.id] }),
  workspace: one(workspace, { fields: [agentRegistration.workspaceId], references: [workspace.id] }),
}));

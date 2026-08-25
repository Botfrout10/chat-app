/** Entity types mirrored from API responses (no shared response types exist yet). */

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
};

export type ChannelType = "public" | "private" | "group" | "dm";

export type Peer = { id: string; name: string };

export type Channel = {
  id: string;
  workspaceId: string;
  name: string;
  type: ChannelType;
  createdBy: string;
  createdAt: string;
  /** populated by API for dm/group channels (peers excluding me) */
  dmPeer?: Peer | Peer[] | null;
};

export type Attachment = {
  id: string;
  messageId: string;
  key: string;
  filename: string;
  mime: string;
  size: number;
};

export type Reaction = {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
};

export type Message = {
  id: string;
  channelId: string;
  senderId: string;
  parentId: string | null;
  content: string;
  /** AI chain-of-thought output (reasoning models), collapsible in the UI */
  reasoning?: string | null;
  nonce: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  sender: User | null;
  attachments: Attachment[];
  reactions: Reaction[];
  mentions?: string[];
  /** set on LLM replies so clients can clear streaming state */
  llmConnectionId?: string | null;
};

export type MessagesPage = {
  messages: Message[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type NotificationType = "mention" | "dm" | "thread" | "channel";

export type AppNotification = {
  id: string;
  userId: string;
  workspaceId: string;
  channelId: string;
  messageId: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

export type NotificationsResponse = {
  items: AppNotification[];
  unread: number;
};

export type Member = User & {
  role: "owner" | "admin" | "member";
  joinedAt: string;
};

export type SearchResult = Message & { channel: Channel };

export type PresignResponse = {
  url: string;
  key: string;
  filename: string;
  mime: string;
  size: number;
  bucket: string;
};

export type LlmConnection = {
  id: string;
  ownerId: string;
  label: string;
  mentionName: string;
  provider: string;
  baseUrl: string;
  modelId: string;
  status: "unverified" | "ok" | "error";
  lastError: string | null;
  createdAt: string;
};

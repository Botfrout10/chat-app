import { deleteToken, loadToken } from "@/lib/session";
import { Platform } from "react-native";
import type {
  AppNotification,
  Channel,
  Member,
  Message,
  MessagesPage,
  NotificationsResponse,
  PresignResponse,
  SearchResult,
  User,
  Workspace,
} from "@/types";

/**
 * Default API base per platform:
 * - Android emulator: 10.0.2.2 is the host machine's loopback alias
 * - Physical devices: set EXPO_PUBLIC_API_URL to your machine's LAN IP
 *   (or run `adb reverse tcp:3001 tcp:3001`)
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "android" ? "http://10.0.2.2:3001" : "http://localhost:3001");

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  const token = await loadToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const hasBody = typeof opts.body !== "undefined" && opts.body !== null;
  if (hasBody && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  // RN fetch has no default timeout — abort after 15s so the UI never spins forever
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...opts, headers, signal: controller.signal });
  } catch (e) {
    throw new ApiError(0, e instanceof Error && e.name === "AbortError" ? "Request timed out — check that the app points at your computer's IP" : `Network error: cannot reach ${API_URL}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = text || `Request failed ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      // API errors use { error }, Better-Auth uses { message, code }
      const raw = parsed?.error ?? parsed?.message;
      if (typeof raw === "string") msg = raw;
      else if (raw) msg = JSON.stringify(raw);
      if (parsed?.code === "INVALID_EMAIL_OR_PASSWORD" || res.status === 401) {
        msg = "Invalid email or password";
      }
      if (Array.isArray(parsed?.fieldErrors)) {
        msg = parsed.fieldErrors.map((f: { message?: string }) => f.message ?? "").join(", ") || msg;
      }
    } catch {
      // plain text body
    }
    throw new ApiError(res.status, msg);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

type AttachmentMeta = { key: string; filename: string; mime: string; size: number };

export const api = {
  // auth (Better-Auth; sign-in/up responses include the session token)
  authSignUp: (email: string, password: string, name: string) =>
    req<{ token: string; user: User }>("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),
  authSignIn: (email: string, password: string) =>
    req<{ token: string; user: User }>("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  authSignOut: () => req("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) }),

  // users
  me: () => req<User>("/api/users/me"),
  searchUsers: (q: string) => req<Partial<User>[]>(`/api/users/search?q=${encodeURIComponent(q)}`),

  // workspaces
  workspaces: () => req<Workspace[]>("/api/workspaces"),
  createWorkspace: (name: string) =>
    req<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) }),
  workspaceMembers: (wsId: string) => req<Member[]>(`/api/workspaces/${wsId}/members`),
  addMember: (wsId: string, user: string) =>
    req(`/api/workspaces/${wsId}/members`, { method: "POST", body: JSON.stringify({ user }) }),
  invite: (wsId: string, email: string, role: string = "member") =>
    req(`/api/workspaces/${wsId}/invites`, { method: "POST", body: JSON.stringify({ email, role }) }),
  findOrCreateDm: (wsId: string, userId: string) =>
    req<Channel & { created: boolean }>(`/api/workspaces/${wsId}/dm`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  // channels
  channels: (wsId: string) => req<Channel[]>(`/api/workspaces/${wsId}/channels`),
  createChannel: (wsId: string, data: { name: string; type?: string }) =>
    req<Channel>(`/api/workspaces/${wsId}/channels`, { method: "POST", body: JSON.stringify(data) }),
  joinChannel: (channelId: string) => req(`/api/channels/${channelId}/join`, { method: "POST", body: "{}" }),
  markRead: (channelId: string, lastReadMessageId: string) =>
    req(`/api/channels/${channelId}/read`, {
      method: "PATCH",
      body: JSON.stringify({ lastReadMessageId }),
    }),

  // messages
  messages: (channelId: string, query?: { before?: string; after?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (query?.before) params.set("before", query.before);
    if (query?.after) params.set("after", query.after);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return req<MessagesPage>(`/api/channels/${channelId}/messages${qs ? `?${qs}` : ""}`);
  },
  sendMessage: (
    channelId: string,
    data: { content: string; parentId?: string | null; attachments?: AttachmentMeta[]; nonce?: string },
  ) => req<Message>(`/api/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(data) }),
  editMessage: (id: string, content: string) =>
    req<Message>(`/api/messages/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteMessage: (id: string) => req<Message>(`/api/messages/${id}`, { method: "DELETE" }),
  replies: (id: string) => req<Message[]>(`/api/messages/${id}/replies`),
  react: (id: string, emoji: string) =>
    req(`/api/messages/${id}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) }),
  unreact: (id: string, emoji: string) =>
    req(`/api/messages/${id}/reactions/${encodeURIComponent(emoji)}`, { method: "DELETE" }),

  // attachments
  presign: (data: { filename: string; mime: string; size: number }) =>
    req<PresignResponse>("/api/attachments/presign", { method: "POST", body: JSON.stringify(data) }),
  signedUrl: (key: string) => req<{ url: string }>(`/api/attachments/${encodeURIComponent(key)}/signed`),

  // notifications
  notifications: () => req<NotificationsResponse>("/api/notifications"),
  markNotificationRead: (id: string) =>
    req(`/api/notifications/${id}/read`, { method: "POST", body: "{}" }),
  markAllNotificationsRead: () => req(`/api/notifications/read-all`, { method: "POST", body: "{}" }),

  // search
  search: (q: string, channelId?: string) =>
    req<SearchResult[]>(
      `/api/search?q=${encodeURIComponent(q)}${channelId ? `&channelId=${channelId}` : ""}`,
    ),
};

export { ApiError };

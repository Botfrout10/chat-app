import { deleteToken, loadToken } from "@/lib/session";
import { Platform } from "react-native";
import type {
  AppNotification,
  Channel,
  LlmConnection,
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

if (__DEV__) {
  // Surface the resolved API URL early so stale .env.local is obvious in Metro logs.
  console.log(`[api] API_URL=${API_URL} (EXPO_PUBLIC_API_URL=${process.env.EXPO_PUBLIC_API_URL ?? "unset"})`);
  if (Platform.OS === "android" && API_URL.includes("localhost")) {
    console.warn(
      `[api] API_URL uses localhost on Android — emulator needs http://10.0.2.2:3001, physical device needs http://<your-LAN-IP>:3001 (run ipconfig, check Wi-Fi IPv4). If using a physical device, set EXPO_PUBLIC_API_URL in apps/mobile/.env.local and restart with --clear.`,
    );
  }
}

/**
 * MinIO presigned URLs are generated with S3_ENDPOINT host (often localhost/minio).
 * Android cannot reach localhost — rewrite to the API host so Image fetch/PUT succeeds.
 * Derives the target host from API_URL: 10.0.2.2 for emulator, LAN IP for physical device.
 * iOS simulator and web keep localhost.
 */
export function rewriteAssetUrl(url: string): string {
  if (Platform.OS !== "android") return url;
  let targetHost = "10.0.2.2";
  try {
    targetHost = new URL(API_URL).hostname;
  } catch {}
  try {
    const u = new URL(url);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "minio") {
      u.hostname = targetHost;
      return u.toString();
    }
  } catch {
    // fallback simple replace for non-URL strings
    return url.replace(/\/\/(localhost|minio|127\.0\.0\.1)(?=[:/])/g, `//${targetHost}`);
  }
  return url;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Invoked once per request when the API answers 401 (excluding sign-in/up).
 * SessionProvider registers a teardown that clears the stored token so the
 * auth gate redirects to login instead of leaving the user "in" the app.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

function isAuthPath(path: string): boolean {
  return path.startsWith("/api/auth/sign-in") || path.startsWith("/api/auth/sign-up");
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
    const raw = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && e.name === "AbortError";
    const isNoRoute = /NoRouteToHost|EHOSTUNREACH|ENETUNREACH|Network request failed/i.test(raw);
    if (isAbort) {
      throw new ApiError(
        0,
        `Request timed out — cannot reach ${API_URL}. Check: phone & laptop on same Wi-Fi, EXPO_PUBLIC_API_URL=http://<LAN-IP>:3001 in apps/mobile/.env.local (ipconfig → Wi-Fi IPv4, now 192.168.19.1), restart Expo with --clear, API on 0.0.0.0:3001.`,
      );
    }
    if (isNoRoute) {
      throw new ApiError(
        0,
        `Host unreachable — cannot reach ${API_URL} (${raw}). Your .env.local was 192.168.1.93 (stale); current Wi-Fi IP is 192.168.19.1. Fix: update apps/mobile/.env.local → EXPO_PUBLIC_API_URL=http://192.168.19.1:3001, restart Expo --clear. Emulator: use http://10.0.2.2:3001 or adb reverse tcp:3001 tcp:3001. Physical device: must share Wi-Fi with laptop.`,
      );
    }
    throw new ApiError(0, `Network error: cannot reach ${API_URL} (${raw}). Check EXPO_PUBLIC_API_URL and that API is listening on 0.0.0.0:3001.`);
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
      if (parsed?.code === "INVALID_EMAIL_OR_PASSWORD") {
        msg = "Invalid email or password";
      }
      if (Array.isArray(parsed?.fieldErrors)) {
        msg = parsed.fieldErrors.map((f: { message?: string }) => f.message ?? "").join(", ") || msg;
      }
    } catch {
      // plain text body
    }
    if (res.status === 401) {
      // Stale/expired token on an authenticated endpoint — tear down the
      // session so the gate sends the user to login (never on sign-in/up).
      if (!isAuthPath(path)) onUnauthorized?.();
      else if (!msg) msg = "Invalid email or password";
    }
    throw new ApiError(res.status, msg);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

type AttachmentMeta = { key: string; filename: string; mime: string; size: number };

export const api = {
  // auth (Better-Auth + bearer plugin: token is in `set-auth-token` header, not just body)
  authSignUp: async (email: string, password: string, name: string) => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (/NoRouteToHost|EHOSTUNREACH|ENETUNREACH|Network request failed/i.test(raw)) {
        throw new ApiError(0, `Host unreachable — cannot reach ${API_URL}. Update apps/mobile/.env.local to http://192.168.19.1:3001 (current Wi-Fi IP) and restart Expo --clear. Emulator: use 10.0.2.2.`);
      }
      throw new ApiError(0, `Network error: cannot reach ${API_URL} (${raw})`);
    }
    const headerToken =
      res.headers.get("set-auth-token") ?? res.headers.get("Set-Auth-Token") ?? res.headers.get("set_auth_token");
    const text = await res.text();
    if (!res.ok) {
      let msg = text || `Request failed ${res.status}`;
      try {
        const p = JSON.parse(text);
        msg = p?.error ?? p?.message ?? msg;
      } catch {}
      throw new ApiError(res.status, msg);
    }
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch {}
    const bodyToken = parsed?.token ?? parsed?.session?.token ?? parsed?.data?.token;
    const token = headerToken ?? bodyToken;
    if (!token) throw new ApiError(res.status, "No session token in response");
    const user: User = parsed?.user ?? parsed?.data?.user ?? parsed;
    return { token: String(token), user };
  },
  authSignIn: async (email: string, password: string) => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (/NoRouteToHost|EHOSTUNREACH|ENETUNREACH|Network request failed/i.test(raw)) {
        throw new ApiError(0, `Host unreachable — cannot reach ${API_URL}. Update apps/mobile/.env.local to http://192.168.19.1:3001 (current Wi-Fi IP) and restart Expo --clear. Emulator: use 10.0.2.2.`);
      }
      throw new ApiError(0, `Network error: cannot reach ${API_URL} (${raw})`);
    }
    const headerToken =
      res.headers.get("set-auth-token") ?? res.headers.get("Set-Auth-Token") ?? res.headers.get("set_auth_token");
    const text = await res.text();
    if (!res.ok) {
      let msg = text || `Request failed ${res.status}`;
      try {
        const p = JSON.parse(text);
        msg = p?.error ?? p?.message ?? msg;
        if (p?.code === "INVALID_EMAIL_OR_PASSWORD") msg = "Invalid email or password";
      } catch {}
      throw new ApiError(res.status, msg);
    }
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch {}
    const bodyToken = parsed?.token ?? parsed?.session?.token ?? parsed?.data?.token;
    const token = headerToken ?? bodyToken;
    if (!token) throw new ApiError(res.status, "No session token in response");
    const user: User = parsed?.user ?? parsed?.data?.user ?? parsed;
    return { token: String(token), user };
  },
  authSignOut: () => req("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) }),

  // users
  me: () => req<User>("/api/users/me"),
  searchUsers: (q: string) => req<Partial<User>[]>(`/api/users/search?q=${encodeURIComponent(q)}`),

  // workspaces
  workspaces: () => req<Workspace[]>("/api/workspaces"),
  createWorkspace: (name: string) =>
    req<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) }),
  workspaceMembers: (wsId: string) => req<Member[]>(`/api/workspaces/${wsId}/members`),
  channelMembers: (channelId: string) => req<Member[]>(`/api/channels/${channelId}/members`),
  addMember: (wsId: string, user: string) =>
    req(`/api/workspaces/${wsId}/members`, { method: "POST", body: JSON.stringify({ user }) }),
  invite: (wsId: string, email: string, role: string = "member") =>
    req(`/api/workspaces/${wsId}/invites`, { method: "POST", body: JSON.stringify({ email, role }) }),
  findOrCreateDm: (wsId: string, userId: string) =>
    req<Channel & { created: boolean }>(`/api/workspaces/${wsId}/dm`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  globalDms: () => req<Channel[]>("/api/dms"),
  createGlobalDm: (data: { userId?: string; email?: string; workspaceId?: string }) =>
    req<Channel & { created: boolean }>("/api/dms", {
      method: "POST",
      body: JSON.stringify(data),
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
  /** Proxied raw fetch via API — avoids MinIO host/signature issues on Android (10.0.2.2). */
  rawUrl: async (key: string): Promise<string> => {
    const token = await loadToken();
    const base = `${API_URL}/api/attachments/${encodeURIComponent(key)}/raw`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },

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

  // AI model connections
  llmConnections: () => req<LlmConnection[]>("/api/llm/connections"),
  createLlmConnection: (data: { label: string; baseUrl: string; modelId: string; mentionName?: string; apiKey?: string }) =>
    req<LlmConnection>("/api/llm/connections", { method: "POST", body: JSON.stringify(data) }),
  deleteLlmConnection: (id: string) =>
    req<{ ok: boolean }>(`/api/llm/connections/${id}`, { method: "DELETE" }),
  llmConnectionStatus: (id: string) =>
    req<{ connection: LlmConnection; providerReachable: boolean; providerModels: string[] | null }>(
      `/api/llm/connections/${id}/status`,
    ),
  llmPreview: (baseUrl: string, apiKey?: string) =>
    req<{ providerReachable: boolean; providerModels: string[] | null; baseUrl: string }>("/api/llm/preview", {
      method: "POST",
      body: JSON.stringify({ baseUrl, ...(apiKey ? { apiKey } : {}) }),
    }),
  createLlmDm: (connectionId: string, workspaceId: string) =>
    req<Channel & { created: boolean }>(`/api/llm/connections/${connectionId}/dm`, {
      method: "POST",
      body: JSON.stringify({ workspaceId }),
    }),

  // agent registrations (Phase B) — minimal mobile: read + prompt
  agents: () => req<any[]>("/api/agents"),
  createAgent: (data: { name: string; workspaceId: string; transport?: string; endpoint?: string; authSecret?: string }) =>
    req<any>("/api/agents", { method: "POST", body: JSON.stringify(data) }),
  deleteAgent: (id: string) => req<{ ok: boolean }>(`/api/agents/${id}`, { method: "DELETE" }),
  agentStatus: (id: string) => req<any>(`/api/agents/${id}/status`),
  agentPreview: (data: { endpoint: string; authSecret?: string; transport?: string }) =>
    req<any>("/api/agents/preview", { method: "POST", body: JSON.stringify(data) }),
  promptAgent: (id: string, data: { channelId: string; content: string; parentId?: string | null; sessionId?: string | null }) =>
    req<any>(`/api/agents/${id}/prompt`, { method: "POST", body: JSON.stringify(data) }),
  createAgentDm: (agentId: string, workspaceId: string) =>
    req<any>(`/api/agents/${agentId}/dm`, { method: "POST", body: JSON.stringify({ workspaceId }) }),
  agentSessions: (agentId: string, channelId?: string) =>
    req<any[]>(`/api/agents/${agentId}/sessions${channelId ? `?channelId=${channelId}` : ""}`),
  approveAgentPermission: (agentId: string, data: { permissionId: string; decision: string; sessionId?: string | null }) =>
    req<any>(`/api/agents/${agentId}/approve`, { method: "POST", body: JSON.stringify(data) }),
  answerAgentQuestion: (agentId: string, data: { questionId: string; answer: string; sessionId?: string | null }) =>
    req<any>(`/api/agents/${agentId}/answer`, { method: "POST", body: JSON.stringify(data) }),

  // push tokens
  registerPushToken: (data: { token: string; platform: "ios" | "android" }) =>
    req<{ ok: boolean; id: string }>("/api/push/register", { method: "POST", body: JSON.stringify(data) }),
  unregisterPushToken: (token: string) => req<{ ok: boolean }>("/api/push/token", { method: "DELETE", body: JSON.stringify({ token }) }),
};

export { ApiError };

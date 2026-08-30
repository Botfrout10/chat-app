const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
export const MINIO_URL = process.env.NEXT_PUBLIC_MINIO_URL ?? API_URL.replace(":3001", ":9000");
export const BUCKET = process.env.NEXT_PUBLIC_S3_BUCKET ?? "chat-attachments";
export const fileUrl = (key: string) => `${MINIO_URL}/${BUCKET}/${key}`;

async function req(path: string, opts: RequestInit = {}) {
  const hasBody = typeof opts.body !== "undefined" && opts.body !== null;
  const headers: Record<string, string> = { ...(opts.headers as any) };
  if (hasBody && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export const api = {
  get: (p: string) => req(p),
  post: (p: string, body?: unknown) => req(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: (p: string, body?: unknown) => req(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: (p: string) => req(p, { method: "DELETE" }),

  // typed helpers
  health: () => req("/health"),
  me: () => req("/api/users/me"),
  workspaces: () => req("/api/workspaces"),
  createWorkspace: (name: string) => req("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) }),
  channels: (wsId: string) => req(`/api/workspaces/${wsId}/channels`),
  createChannel: (wsId: string, data: any) => req(`/api/workspaces/${wsId}/channels`, { method: "POST", body: JSON.stringify(data) }),
  messages: (channelId: string, q?: string) => req(`/api/channels/${channelId}/messages${q ?? ""}`),
  message: (id: string) => req(`/api/messages/${id}`),
  replies: (id: string) => req(`/api/messages/${id}/replies`),
  sendMessage: (channelId: string, data: any) => req(`/api/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(data) }),
  createDm: (wsId: string, userId: string) => req(`/api/workspaces/${wsId}/dm`, { method: "POST", body: JSON.stringify({ userId }) }),
  editMessage: (id: string, content: string) => req(`/api/messages/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteMessage: (id: string) => req(`/api/messages/${id}`, { method: "DELETE" }),
  react: (id: string, emoji: string) => req(`/api/messages/${id}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) }),
  unreact: (id: string, emoji: string) => req(`/api/messages/${id}/reactions/${encodeURIComponent(emoji)}`, { method: "DELETE" }),
  presign: (data: any) => req(`/api/attachments/presign`, { method: "POST", body: JSON.stringify(data) }),
  search: (q: string, channelId?: string) => req(`/api/search?q=${encodeURIComponent(q)}${channelId ? `&channelId=${channelId}` : ""}`),
  invite: (wsId: string, email: string, role: string) => req(`/api/workspaces/${wsId}/invites`, { method: "POST", body: JSON.stringify({ email, role }) }),
  addMember: (wsId: string, user: string) => req(`/api/workspaces/${wsId}/members`, { method: "POST", body: JSON.stringify({ user }) }),
  members: (wsId: string) => req(`/api/workspaces/${wsId}/members`),
  channelMembers: (channelId: string) => req(`/api/channels/${channelId}/members`),
  markRead: (channelId: string, lastReadMessageId: string) =>
    req(`/api/channels/${channelId}/read`, { method: "PATCH", body: JSON.stringify({ lastReadMessageId }) }),
  dms: () => req(`/api/dms`),
  createDmGlobal: (data: { userId?: string; email?: string; workspaceId?: string }) =>
    req(`/api/dms`, { method: "POST", body: JSON.stringify(data) }),
  searchUsers: (q: string) => req(`/api/users/search?q=${encodeURIComponent(q)}`),
  inviteMeta: (token: string) => req(`/api/invites/${token}`),
  acceptInvite: (token: string) => req(`/api/invites/${token}/accept`, { method: "POST", body: JSON.stringify({}) }),
  notifications: () => req(`/api/notifications`),
  markNotificationRead: (id: string) => req(`/api/notifications/${id}/read`, { method: "POST", body: JSON.stringify({}) }),
  markAllNotificationsRead: () => req(`/api/notifications/read-all`, { method: "POST", body: JSON.stringify({}) }),
  authSignUp: (email: string, password: string, name: string) =>
    req(`/api/auth/sign-up/email`, { method: "POST", body: JSON.stringify({ email, password, name }) }),
  authSignIn: (email: string, password: string) =>
    req(`/api/auth/sign-in/email`, { method: "POST", body: JSON.stringify({ email, password }) }),
  authSignOut: () => req(`/api/auth/sign-out`, { method: "POST", body: JSON.stringify({}) }),

  // AI model connections
  llmConnections: () => req(`/api/llm/connections`),
  createLlmConnection: (data: { label: string; baseUrl: string; modelId: string; mentionName?: string; apiKey?: string }) =>
    req(`/api/llm/connections`, { method: "POST", body: JSON.stringify(data) }),
  deleteLlmConnection: (id: string) => req(`/api/llm/connections/${id}`, { method: "DELETE" }),
  verifyLlmConnection: (id: string) => req(`/api/llm/connections/${id}/verify`, { method: "POST", body: JSON.stringify({}) }),
  llmConnectionStatus: (id: string) => req(`/api/llm/connections/${id}/status`),
  llmPreview: (baseUrl: string, apiKey?: string) => req(`/api/llm/preview`, { method: "POST", body: JSON.stringify({ baseUrl, ...(apiKey ? { apiKey } : {}) }) }),
  createLlmDm: (connectionId: string, workspaceId: string) =>
    req(`/api/llm/connections/${connectionId}/dm`, { method: "POST", body: JSON.stringify({ workspaceId }) }),

  // Agent registrations (Phase B)
  agents: () => req(`/api/agents`),
  createAgent: (data: { name: string; workspaceId: string; transport?: string; endpoint?: string; authSecret?: string }) =>
    req(`/api/agents`, { method: "POST", body: JSON.stringify(data) }),
  deleteAgent: (id: string) => req(`/api/agents/${id}`, { method: "DELETE" }),
  verifyAgent: (id: string) => req(`/api/agents/${id}/verify`, { method: "POST", body: JSON.stringify({}) }),
  agentStatus: (id: string) => req(`/api/agents/${id}/status`),
  agentPreview: (data: { endpoint: string; authSecret?: string; transport?: string }) =>
    req(`/api/agents/preview`, { method: "POST", body: JSON.stringify(data) }),
  updateAgent: (id: string, data: any) => req(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
};

export { API_URL };

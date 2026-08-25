import { io, type Socket } from "socket.io-client";

import { API_URL } from "@/api/client";
import { peekToken } from "@/lib/session";

let socket: Socket | null = null;

/**
 * Singleton socket. Auth via `auth.token` — the server converts it to a
 * Bearer header in its handshake middleware (no cookie jar needed).
 * Call `resetSocket()` after sign-in/sign-out so the next getSocket()
 * re-handshakes with the current token.
 */
export function getSocket(): Socket {
  if (socket) return socket;
  const token = peekToken();
  socket = io(API_URL, {
    path: "/socket.io",
    transports: ["websocket"],
    autoConnect: false,
    auth: token ? { token } : {},
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket(): void {
  socket?.disconnect();
}

export function resetSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

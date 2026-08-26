import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, setUnauthorizedHandler } from "@/api/client";
import {
  SessionContext,
  deleteToken,
  loadToken,
  saveToken,
  type Session,
} from "@/lib/session";
import { disconnectSocket, resetSocket } from "@/lib/socket";
import { useChatStore } from "@/stores/chat";
import { useUiStore } from "@/stores/ui";

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadToken().then((t) => {
      if (!cancelled) {
        setToken(t);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 401 from any authenticated endpoint → drop the local session so the
  // auth gate redirects to login. Mirrors signOut() minus the server call.
  const tokenRef = useRef(token);
  tokenRef.current = token;
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!tokenRef.current) return; // already signed out — don't loop
      void (async () => {
        await deleteToken();
        resetSocket();
        useChatStore.getState().reset();
        useUiStore.getState().reset();
        queryClient.clear();
        setToken(null);
      })();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const session = useMemo<Session>(
    () => ({
      ready,
      token,
      signIn: async (t: string) => {
        await saveToken(t);
        resetSocket();
        setToken(t);
      },
      signOut: async () => {
        try {
          await api.authSignOut();
        } catch {
          // sign-out server-side is best effort; clear locally regardless
        }
        await deleteToken();
        disconnectSocket();
        resetSocket();
        useChatStore.getState().reset();
        useUiStore.getState().reset();
        queryClient.clear();
        setToken(null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, token],
  );

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

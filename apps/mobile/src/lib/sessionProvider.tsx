import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "@/api/client";
import {
  SessionContext,
  deleteToken,
  loadToken,
  saveToken,
  type Session,
} from "@/lib/session";
import { disconnectSocket, resetSocket } from "@/lib/socket";
import { useChatStore } from "@/stores/chat";

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
        queryClient.clear();
        setToken(null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, token],
  );

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

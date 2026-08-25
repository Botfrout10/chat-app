import * as SecureStore from "expo-secure-store";
import { createContext, useContext } from "react";

const TOKEN_KEY = "pulse.session_token";

/** Module-level cache so the API client and socket can read the token synchronously. */
let cachedToken: string | null = null;

export async function loadToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

/** Synchronous read of the cached token (valid after loadToken has run once). */
export function peekToken(): string | null {
  return cachedToken;
}

export async function saveToken(token: string): Promise<void> {
  cachedToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function deleteToken(): Promise<void> {
  cachedToken = null;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // already gone
  }
}

export type Session = {
  /** null until the secure store has been read once */
  ready: boolean;
  token: string | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const SessionContext = createContext<Session>({
  ready: false,
  token: null,
  signIn: async () => {},
  signOut: async () => {},
});

export function useSession(): Session {
  return useContext(SessionContext);
}

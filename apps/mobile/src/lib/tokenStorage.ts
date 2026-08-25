import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TOKEN_KEY = "pulse.session_token";

/**
 * Token storage abstraction.
 * - Native: expo-secure-store (Keychain / Keystore)
 * - Web: localStorage (expo-secure-store's web build is incomplete and
 *   throws `setValueWithKeyAsync is not a function`)
 */
export const tokenStorage = {
  async get(): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return window.localStorage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  async set(token: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        window.localStorage.setItem(TOKEN_KEY, token);
      } catch {
        // private mode etc. — session just won't persist
      }
      return;
    }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },
  async delete(): Promise<void> {
    if (Platform.OS === "web") {
      try {
        window.localStorage.removeItem(TOKEN_KEY);
      } catch {
        // ignore
      }
      return;
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

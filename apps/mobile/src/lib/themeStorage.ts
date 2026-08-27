import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { ThemeMode } from "@/stores/ui";

const THEME_KEY = "pulse.theme";

/**
 * Persisted theme preference (system | light | dark).
 * - Native: expo-secure-store (Keychain / Keystore)
 * - Web: localStorage (expo-secure-store's web build is incomplete)
 */
export const themeStorage = {
  async get(): Promise<ThemeMode | null> {
    try {
      const raw =
        Platform.OS === "web"
          ? window.localStorage.getItem(THEME_KEY)
          : await SecureStore.getItemAsync(THEME_KEY);
      return raw === "light" || raw === "dark" || raw === "system" ? raw : null;
    } catch {
      return null;
    }
  },
  async set(mode: ThemeMode): Promise<void> {
    try {
      if (Platform.OS === "web") window.localStorage.setItem(THEME_KEY, mode);
      else await SecureStore.setItemAsync(THEME_KEY, mode);
    } catch {
      // ignore — theme just falls back to system
    }
  },
};

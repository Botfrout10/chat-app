import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { api } from "@/api/client";
import { loadToken } from "@/lib/session";
import * as SecureStore from "expo-secure-store";

const PUSH_REGISTERED_KEY = "push_registered_token";

// Lazily load expo-notifications so the app doesn't crash in Expo Go
// (remote notifications were removed from Expo Go in SDK 53).
function getNotifications(): typeof import("expo-notifications") | null {
  // Expo Go (StoreClient) does not support remote push — skip entirely.
  // Constants.appOwnership === "expo" when running in Expo Go;
  // Constants.executionEnvironment === "storeClient" is the newer check.
  const ownership = (Constants as unknown as { appOwnership?: string }).appOwnership;
  const env = (Constants as unknown as { executionEnvironment?: string }).executionEnvironment;
  if (ownership === "expo" || env === "storeClient") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-notifications") as typeof import("expo-notifications");
    // Defensive: if the module is a stub that throws on access, treat as unavailable.
    if (!mod?.getPermissionsAsync || !mod?.getExpoPushTokenAsync) return null;
    return mod;
  } catch {
    return null;
  }
}

let handlerSet = false;
function ensureHandler() {
  if (handlerSet) return;
  const Notifications = getNotifications();
  if (!Notifications?.setNotificationHandler) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    handlerSet = true;
  } catch {
    // Expo Go or missing native module — ignore
  }
}

export function usePushRegistration(enabled: boolean) {
  const registered = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    ensureHandler();
    const Notifications = getNotifications();
    if (!Notifications) {
      // Running in Expo Go or native module unavailable — push is dev-build only.
      if (__DEV__) console.log("[push] skipped — push requires a development build (not Expo Go)");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await loadToken();
        if (!token) return;
        if (!Device.isDevice) return; // simulator can't get token
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;

        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
          });
        }

        const expoToken = (await Notifications.getExpoPushTokenAsync()).data;
        if (!expoToken || cancelled) return;
        const already = await SecureStore.getItemAsync(PUSH_REGISTERED_KEY);
        if (already === expoToken && registered.current === expoToken) return;

        const platform = Platform.OS === "ios" ? "ios" : "android";
        await api.registerPushToken({ token: expoToken, platform });
        await SecureStore.setItemAsync(PUSH_REGISTERED_KEY, expoToken);
        registered.current = expoToken;
      } catch (e) {
        // fail open — don't block chat if push registration fails
        console.warn("[push] registration failed", (e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { api } from "@/api/client";
import { loadToken } from "@/lib/session";
import * as SecureStore from "expo-secure-store";

const PUSH_REGISTERED_KEY = "push_registered_token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function usePushRegistration(enabled: boolean) {
  const registered = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
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

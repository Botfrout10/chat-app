import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CommandPalette } from "@/components/chat/CommandPalette";
import { useChatEvents } from "@/hooks/useChatEvents";
import { SessionProvider } from "@/lib/sessionProvider";
import { useSession } from "@/lib/session";
import { themeStorage } from "@/lib/themeStorage";
import { useTheme } from "@/theme/useTheme";
import { useUiStore } from "@/stores/ui";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

/** Connects the socket and pipes events into the caches for the whole app. */
function EventBridge() {
  const { token } = useSession();
  useChatEvents(!!token);
  return null;
}

/** Restores the persisted theme choice (system | light | dark) on launch. */
function ThemeBridge() {
  const setTheme = useUiStore((s) => s.setTheme);
  useEffect(() => {
    void themeStorage.get().then((saved) => {
      if (saved) setTheme(saved);
    });
  }, [setTheme]);
  return null;
}

function RootStack() {
  const t = useTheme();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.background },
        }}
      >
        <Stack.Screen name="channel/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="thread/[id]" options={{ animation: "slide_from_right" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <EventBridge />
          <ThemeBridge />
          <CommandPalette />
          <RootStack />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useChatEvents } from "@/hooks/useChatEvents";
import { SessionProvider } from "@/lib/sessionProvider";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";

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

/**
 * Root auth gate: nothing inside the navigator renders (including any
 * dev-restored deep route) until the session token exists.
 */
function RootGate({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { ready, token } = useSession();

  if (!ready) {
    return (
      <View style={[styles.splash, { backgroundColor: t.background }]}>
        <Text style={[styles.logo, { color: t.primary }]}>Pulse</Text>
        <ActivityIndicator color={t.accent500} />
      </View>
    );
  }
  if (!token) {
    return <Redirect href="/(auth)/login" />;
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  logo: { fontSize: 40, fontWeight: "800" },
});

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
          <RootGate>
            <RootStack />
          </RootGate>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

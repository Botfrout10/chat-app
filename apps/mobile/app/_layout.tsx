import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "@/lib/sessionProvider";
import { useTheme } from "@/theme/useTheme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
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
        <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
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
          <RootStack />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

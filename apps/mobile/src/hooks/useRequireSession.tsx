import { Redirect } from "expo-router";
import { type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";

/**
 * Session blocker for protected areas. Must be called from components INSIDE
 * the navigator (layouts/screens) — a <Redirect> rendered outside the
 * navigator re-fires on every render and causes an infinite loop.
 *
 * Returns a blocking element while the session is unresolved/absent,
 * or null when the caller may render.
 */
export function useRequireSession(): ReactNode | null {
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
  return null;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  logo: { fontSize: 40, fontWeight: "800" },
});

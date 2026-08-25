import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useMe } from "@/hooks/queries";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";

/** Auth gate: bounces to login when signed out, to chats when signed in. */
export default function Gate() {
  const { ready, token } = useSession();
  const t = useTheme();
  const meQuery = useMe(!!token);

  if (!ready || (!!token && meQuery.isPending)) {
    return (
      <View style={[styles.container, { backgroundColor: t.background }]}>
        <Text style={[styles.logo, { color: t.primary }]}>Pulse</Text>
        <ActivityIndicator color={t.accent500} />
      </View>
    );
  }

  if (!token || meQuery.isError) {
    return <Redirect href="/(auth)/login" />;
  }
  return <Redirect href="/(tabs)/chats" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  logo: {
    fontSize: 40,
    fontWeight: "800",
  },
});

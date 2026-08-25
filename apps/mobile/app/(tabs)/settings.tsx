import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useMe } from "@/hooks/queries";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const { token, signOut } = useSession();
  const meQuery = useMe(!!token);

  async function handleSignOut() {
    await signOut();
    router.replace("/(auth)/login");
  }

  const me = meQuery.data;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
      <View style={styles.content}>
        <Text style={[styles.heading, { color: t.foreground }]}>Settings</Text>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          {meQuery.isPending ? (
            <ActivityIndicator color={t.primary} />
          ) : me ? (
            <>
              <View style={[styles.avatar, { backgroundColor: t.accent100 }]}>
                <Text style={[styles.avatarText, { color: t.accent700 }]}>
                  {(me.name ?? "?").slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.name, { color: t.foreground }]}>{me.name}</Text>
                <Text style={[styles.email, { color: t.mutedForeground }]}>{me.email}</Text>
              </View>
            </>
          ) : (
            <Text style={{ color: t.mutedForeground }}>Not signed in</Text>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={handleSignOut}
          style={({ pressed }) => [
            styles.signOut,
            { backgroundColor: t.destructive + "14", opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.signOutText, { color: t.destructive }]}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, gap: 16 },
  heading: { fontSize: 28, fontWeight: "800", marginTop: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "700" },
  flex: { flex: 1 },
  name: { fontSize: 16, fontWeight: "600" },
  email: { fontSize: 13, marginTop: 2 },
  signOut: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutText: { fontSize: 15, fontWeight: "600" },
});

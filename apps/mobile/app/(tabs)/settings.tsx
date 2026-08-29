import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useMe } from "@/hooks/queries";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";
import { useUiStore, type ThemeMode } from "@/stores/ui";

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const { token, signOut } = useSession();
  const meQuery = useMe(!!token);
  const insets = useSafeAreaInsets();
  const openDialog = useUiStore((s) => s.openDialog);

  async function handleSignOut() {
    await signOut();
    router.replace("/(auth)/login");
  }

  const me = meQuery.data;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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

        <ThemeRow />

        {!!token && (
          <Pressable
            accessibilityRole="button"
            onPress={() => openDialog("llmManager")}
            style={({ pressed }) => [styles.cardCol, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[styles.llmIcon, { backgroundColor: t.accent100 }]}>
                  <Ionicons name="hardware-chip-outline" size={16} color={t.accent700} />
                </View>
                <View>
                  <Text style={[styles.rowTitle2, { color: t.foreground }]}>AI models</Text>
                  <Text style={{ color: t.mutedForeground, fontSize: 12 }}>Connect & manage OpenAI-compatible endpoints</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.mutedForeground} />
            </View>
          </Pressable>
        )}

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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Light / Dark / System appearance switch (web has an equivalent in the account footer). */
function ThemeRow() {
  const t = useTheme();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const options: { mode: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { mode: "system", label: "System", icon: "phone-portrait-outline" },
    { mode: "light", label: "Light", icon: "sunny-outline" },
    { mode: "dark", label: "Dark", icon: "moon-outline" },
  ];

  return (
    <View style={[styles.cardCol, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.sectionTitle, { color: t.mutedForeground }]}>APPEARANCE</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {options.map((o) => {
          const active = theme === o.mode;
          return (
            <Pressable
              key={o.mode}
              accessibilityRole="button"
              onPress={() => setTheme(o.mode)}
              style={({ pressed }) => [
                styles.segBtn,
                { backgroundColor: active ? t.primary : t.muted, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Ionicons name={o.icon} size={16} color={active ? t.primaryForeground : t.foreground} />
              <Text style={{ color: active ? t.primaryForeground : t.foreground, fontWeight: "600", fontSize: 13 }}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
  cardCol: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "800" },
  flex: { flex: 1 },
  name: { fontSize: 16, fontWeight: "600" },
  email: { fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  connectBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  connectBtnText: { fontSize: 14, fontWeight: "700" },
  connRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle2: { fontSize: 14, fontWeight: "600" },
  llmIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
  },
  signOut: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutText: { fontSize: 15, fontWeight: "600" },
});

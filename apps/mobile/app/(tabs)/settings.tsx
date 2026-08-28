import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { useMe } from "@/hooks/queries";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";
import { useUiStore, type ThemeMode } from "@/stores/ui";
import type { LlmConnection } from "@/types";

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
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

        <ThemeRow />

        {!!token && <LlmManager />}

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

/** Connect / remove personal OpenAI-compatible model endpoints. */
function LlmManager() {
  const t = useTheme();
  const queryClient = useQueryClient();
  const listQuery = useQuery({ queryKey: ["llm-connections"], queryFn: () => api.llmConnections() });
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["llm-connections"] });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.createLlmConnection({
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }),
    onSuccess: () => {
      setLabel("");
      setBaseUrl("");
      setModelId("");
      setApiKey("");
      setError(null);
      setShowForm(false);
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message.slice(0, 200) : "Failed to connect model"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteLlmConnection(id),
    onSuccess: invalidate,
    onError: (e) => Alert.alert("Delete failed", e instanceof Error ? e.message : "Unknown error"),
  });

  function confirmDelete(conn: LlmConnection) {
    Alert.alert("Remove model", `Disconnect "${conn.label}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteMutation.mutate(conn.id) },
    ]);
  }

  function submit() {
    setError(null);
    if (!label.trim() || !baseUrl.trim() || !modelId.trim()) {
      setError("All fields are required");
      return;
    }
    createMutation.mutate();
  }

  const conns = listQuery.data ?? [];

  return (
    <View style={[styles.cardCol, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: t.mutedForeground }]}>AI MODELS</Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowForm((v) => !v)}>
          <Ionicons name={showForm ? "close" : "add-circle-outline"} size={22} color={t.primary} />
        </Pressable>
      </View>

      {showForm && (
        <View style={{ gap: 8 }}>
          <TextInput
            style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground }]}
            placeholder="Label (e.g. My LM Studio)"
            placeholderTextColor={t.mutedForeground}
            value={label}
            onChangeText={setLabel}
          />
          <TextInput
            style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground }]}
            placeholder="Base URL (e.g. http://192.168.1.93:1234)"
            placeholderTextColor={t.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={baseUrl}
            onChangeText={setBaseUrl}
          />
          <TextInput
            style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground }]}
            placeholder="Model ID (as reported by the provider)"
            placeholderTextColor={t.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            value={modelId}
            onChangeText={setModelId}
          />
          <TextInput
            style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground }]}
            placeholder="API key (for cloud, blank for local)"
            placeholderTextColor={t.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={apiKey}
            onChangeText={setApiKey}
          />
          {!!error && <Text style={{ color: t.destructive, fontSize: 12 }}>{error}</Text>}
          <Pressable
            accessibilityRole="button"
            disabled={createMutation.isPending}
            onPress={submit}
            style={({ pressed }) => [
              styles.connectBtn,
              { backgroundColor: t.primary, opacity: pressed || createMutation.isPending ? 0.8 : 1 },
            ]}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={t.primaryForeground} size="small" />
            ) : (
              <Text style={[styles.connectBtnText, { color: t.primaryForeground }]}>Connect & verify</Text>
            )}
          </Pressable>
        </View>
      )}

      {listQuery.isPending && <ActivityIndicator color={t.primary} />}
      {!listQuery.isPending && !conns.length && !showForm && (
        <Text style={{ color: t.mutedForeground, fontSize: 13 }}>
          No models connected — tap + to add an OpenAI-compatible endpoint.
        </Text>
      )}
      {conns.map((conn) => (
        <View key={conn.id} style={styles.connRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  conn.status === "ok" ? t.success : conn.status === "error" ? t.destructive : t.warning,
              },
            ]}
          />
          <View style={styles.flex}>
            <Text style={[styles.rowTitle2, { color: t.foreground }]} numberOfLines={1}>
              {conn.label}
            </Text>
            <Text style={{ color: t.mutedForeground, fontSize: 12 }} numberOfLines={1}>
              {conn.modelId}
              {conn.status === "error" && !!conn.lastError ? ` — ${conn.lastError}` : ""}
            </Text>
          </View>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => confirmDelete(conn)}>
            <Ionicons name="trash-outline" size={18} color={t.destructive} />
          </Pressable>
        </View>
      ))}
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

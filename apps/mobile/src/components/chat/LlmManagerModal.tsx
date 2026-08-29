import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/api/client";
import { useTheme } from "@/theme/useTheme";
import type { LlmConnection } from "@/types";

function isValidUrl(s: string) {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export function LlmManagerModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["llm-connections"],
    queryFn: () => api.llmConnections(),
    enabled: visible,
  });

  // form state
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelId, setModelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);

  // debounce baseUrl + apiKey for preview
  const [debouncedBaseUrl, setDebouncedBaseUrl] = useState(baseUrl.trim());
  const [debouncedApiKey, setDebouncedApiKey] = useState(apiKey.trim());

  useEffect(() => {
    const id = setTimeout(() => setDebouncedBaseUrl(baseUrl.trim()), 500);
    return () => clearTimeout(id);
  }, [baseUrl]);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedApiKey(apiKey.trim()), 500);
    return () => clearTimeout(id);
  }, [apiKey]);

  useEffect(() => {
    // clear model when url/key changes
    setModelId("");
  }, [debouncedBaseUrl, debouncedApiKey]);

  useEffect(() => {
    if (!visible) {
      setOpenStatusId(null);
      setError(null);
    }
  }, [visible]);

  const canPreview = visible && !!debouncedBaseUrl && isValidUrl(debouncedBaseUrl);
  const previewQuery = useQuery({
    queryKey: ["llm-preview", debouncedBaseUrl, debouncedApiKey ? "key" : "nokey"],
    queryFn: async () => {
      try {
        const res: any = await api.llmPreview(debouncedBaseUrl, debouncedApiKey || undefined);
        return res as { providerReachable: boolean; providerModels: string[] | null; baseUrl: string };
      } catch (e: any) {
        let msg = e instanceof Error ? e.message : String(e);
        try {
          const parsed = JSON.parse(msg);
          msg = parsed.error ?? msg;
        } catch {}
        throw new Error(msg);
      }
    },
    enabled: canPreview,
    retry: false,
    staleTime: 30_000,
  });

  const previewError = (previewQuery.error as Error | null)?.message ?? null;
  const providerModels: string[] | null = (previewQuery.data as any)?.providerModels ?? null;

  // status detail per connection
  const statusQuery = useQuery({
    queryKey: ["llm-status", openStatusId],
    queryFn: () => api.llmConnectionStatus(openStatusId!),
    enabled: visible && !!openStatusId,
  });

  const createMutation = useMutation({
    mutationFn: (vars: { label: string; baseUrl: string; modelId: string; apiKey?: string }) => api.createLlmConnection(vars),
    onSuccess: () => {
      setLabel("");
      setModelId("");
      setApiKey("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["llm-connections"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message.slice(0, 300) : "Failed to connect"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteLlmConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm-connections"] }),
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
    if (!isValidUrl(baseUrl.trim())) {
      setError("Base URL is not valid. Include http://");
      return;
    }
    createMutation.mutate({
      label: label.trim(),
      baseUrl: baseUrl.trim(),
      modelId: modelId.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
  }

  const conns: LlmConnection[] = (listQuery.data as any) ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: t.accent100 }]}>
              <Ionicons name="hardware-chip-outline" size={18} color={t.accent700} />
            </View>
            <Text style={[styles.title, { color: t.foreground }]}>AI models</Text>
            <Pressable onPress={onClose} hitSlop={8} style={[styles.closeBtn, { backgroundColor: t.muted }]}>
              <Ionicons name="close" size={18} color={t.foreground} />
            </Pressable>
          </View>
          <Text style={{ color: t.mutedForeground, fontSize: 12, paddingHorizontal: 16, paddingBottom: 8 }}>
            Connect a local or cloud LLM via an OpenAI-compatible endpoint.
          </Text>

          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* existing connections */}
            {listQuery.isPending ? (
              <ActivityIndicator color={t.primary} />
            ) : !conns.length ? (
              <Text style={{ color: t.mutedForeground, fontSize: 13 }}>No models connected yet — add your first below.</Text>
            ) : (
              conns.map((c) => {
                const expanded = openStatusId === c.id;
                return (
                  <View key={c.id} style={[styles.connCard, { borderColor: t.border, backgroundColor: t.background }]}>
                    <Pressable onPress={() => setOpenStatusId(expanded ? null : c.id)} style={styles.connHeader}>
                      <View
                        style={[
                          styles.dot,
                          {
                            backgroundColor: c.status === "ok" ? t.success : c.status === "error" ? t.destructive : t.warning,
                          },
                        ]}
                      />
                      <View style={{ flex: 1, gap: 1 }}>
                        <Text style={[styles.connLabel, { color: t.foreground }]} numberOfLines={1}>
                          {c.label}
                        </Text>
                        <Text style={{ color: t.mutedForeground, fontSize: 11 }} numberOfLines={1}>
                          @{c.mentionName} · {c.modelId}
                        </Text>
                      </View>
                      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={t.mutedForeground} />
                      <Pressable hitSlop={8} onPress={() => confirmDelete(c)} style={{ padding: 4 }}>
                        <Ionicons name="trash-outline" size={16} color={t.destructive} />
                      </Pressable>
                    </Pressable>
                    {c.status === "error" && c.lastError && !expanded && <Text style={{ color: t.destructive, fontSize: 11, paddingHorizontal: 12, paddingBottom: 8 }}>{c.lastError}</Text>}
                    {expanded && (
                      <View style={[styles.detail, { borderTopColor: t.border }]}>
                        {!statusQuery.data && statusQuery.isFetching ? (
                          <ActivityIndicator color={t.primary} size="small" />
                        ) : statusQuery.data ? (
                          <>
                            <View style={styles.detailRow}>
                              <Text style={[styles.detailKey, { color: t.mutedForeground }]}>Endpoint</Text>
                              <Text style={[styles.detailVal, { color: t.foreground }]}>{(statusQuery.data as any).connection.baseUrl}</Text>
                            </View>
                            <View style={styles.detailRow}>
                              <Text style={[styles.detailKey, { color: t.mutedForeground }]}>Model</Text>
                              <Text style={[styles.detailVal, { color: t.foreground }]}>{(statusQuery.data as any).connection.modelId}</Text>
                            </View>
                            <View style={styles.detailRow}>
                              <Text style={[styles.detailKey, { color: t.mutedForeground }]}>Provider</Text>
                              <Text style={{ color: (statusQuery.data as any).providerReachable ? t.success : t.destructive, fontSize: 12 }}>
                                {(statusQuery.data as any).providerReachable
                                  ? `reachable · ${((statusQuery.data as any).providerModels?.length ?? 0)} model(s)`
                                  : "unreachable"}
                              </Text>
                            </View>
                            {(statusQuery.data as any).providerModels != null &&
                              !(statusQuery.data as any).providerModels.includes((statusQuery.data as any).connection.modelId) && (
                                <Text style={{ color: t.destructive, fontSize: 11 }}>Model not in provider list — it may have been unloaded.</Text>
                              )}
                            {(statusQuery.data as any).providerModels?.length > 0 && (
                              <View style={{ gap: 4, marginTop: 4 }}>
                                <Text style={{ color: t.mutedForeground, fontSize: 11, fontWeight: "700" }}>Provider models</Text>
                                {((statusQuery.data as any).providerModels as string[]).slice(0, 20).map((m: string) => (
                                  <Text key={m} style={{ color: t.mutedForeground, fontSize: 11, fontFamily: "monospace" }}>
                                    · {m}
                                  </Text>
                                ))}
                              </View>
                            )}
                            <Pressable
                              onPress={() => statusQuery.refetch()}
                              style={({ pressed }) => [styles.smallBtn, { borderColor: t.border, opacity: pressed ? 0.7 : 1 }]}
                            >
                              <Ionicons name="refresh" size={14} color={t.primary} />
                              <Text style={{ color: t.primary, fontSize: 12, fontWeight: "600" }}>Re-check</Text>
                            </Pressable>
                          </>
                        ) : (
                          <Text style={{ color: t.mutedForeground, fontSize: 12 }}>No status yet.</Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}

            {/* connect form */}
            <View style={[styles.form, { borderTopColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.mutedForeground }]}>CONNECT A MODEL</Text>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: t.mutedForeground }]}>Provider URL</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput
                    style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground, flex: 1 }]}
                    placeholder="http://localhost:1234 (LM Studio default)"
                    placeholderTextColor={t.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    value={baseUrl}
                    onChangeText={setBaseUrl}
                  />
                  <Pressable
                    onPress={() => previewQuery.refetch()}
                    disabled={!isValidUrl(baseUrl.trim())}
                    style={({ pressed }) => [styles.iconBtn, { backgroundColor: t.muted, borderColor: t.border, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Ionicons name="refresh" size={16} color={isValidUrl(baseUrl.trim()) ? t.primary : t.mutedForeground} />
                  </Pressable>
                </View>
                <Text style={{ color: t.mutedForeground, fontSize: 11 }}>OpenAI-compatible base URL. We fetch {"{base}/models"} to list models.</Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: t.mutedForeground }]}>API key <Text style={{ opacity: 0.6 }}>(required for cloud, blank for local)</Text></Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput
                    style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground, flex: 1 }]}
                    placeholder="sk-… (stored encrypted)"
                    placeholderTextColor={t.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={!showKey}
                    value={apiKey}
                    onChangeText={setApiKey}
                  />
                  <Pressable onPress={() => setShowKey((v) => !v)} style={({ pressed }) => [styles.iconBtn, { backgroundColor: t.muted, borderColor: t.border, opacity: pressed ? 0.7 : 1 }]}>
                    <Ionicons name={showKey ? "eye-off-outline" : "eye-outline"} size={16} color={t.foreground} />
                  </Pressable>
                </View>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: t.mutedForeground }]}>Model</Text>
                {previewQuery.isFetching ? (
                  <View style={[styles.placeholder, { backgroundColor: t.muted, borderColor: t.border }]}>
                    <ActivityIndicator color={t.primary} size="small" />
                    <Text style={{ color: t.mutedForeground, fontSize: 12, marginLeft: 8 }}>Loading models…</Text>
                  </View>
                ) : providerModels && providerModels.length > 0 ? (
                  <>
                    <ScrollView style={[styles.modelList, { borderColor: t.inputBorder, backgroundColor: t.input }]} nestedScrollEnabled>
                      {providerModels.map((m) => {
                        const selected = m === modelId;
                        return (
                          <Pressable key={m} onPress={() => setModelId(m)} style={[styles.modelItem, { backgroundColor: selected ? t.accent100 : "transparent" }]}>
                            <Text style={{ color: selected ? t.accent700 : t.foreground, fontSize: 13, fontFamily: "monospace", flex: 1 }} numberOfLines={1}>
                              {m}
                            </Text>
                            {selected && <Ionicons name="checkmark" size={16} color={t.accent700} />}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    <Text style={{ color: t.mutedForeground, fontSize: 11 }}>{providerModels.length} model(s) available {modelId ? `· selected: ${modelId}` : "· tap to select"}</Text>
                  </>
                ) : previewError ? (
                  <>
                    <View style={[styles.errorBox, { borderColor: t.destructive + "55", backgroundColor: t.destructive + "12" }]}>
                      <Text style={{ color: t.destructive, fontSize: 12 }}>{previewError}</Text>
                    </View>
                    <TextInput
                      style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground }]}
                      placeholder="Model name exactly as provider reports it (fallback)"
                      placeholderTextColor={t.mutedForeground}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={modelId}
                      onChangeText={setModelId}
                    />
                  </>
                ) : !isValidUrl(debouncedBaseUrl) ? (
                  <View style={[styles.placeholder, { borderColor: t.border, backgroundColor: "transparent", borderStyle: "dashed" }]}>
                    <Text style={{ color: t.mutedForeground, fontSize: 12 }}>Enter a valid URL to load models</Text>
                  </View>
                ) : (
                  <View style={[styles.placeholder, { borderColor: t.border, backgroundColor: "transparent", borderStyle: "dashed" }]}>
                    <Text style={{ color: t.mutedForeground, fontSize: 12 }}>No models found — check provider is running</Text>
                  </View>
                )}
                {/* when preview shows but no models yet, allow manual fallback? */}
                {providerModels && providerModels.length === 0 && !previewError && (
                  <TextInput
                    style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground, marginTop: 6 }]}
                    placeholder="Model ID (fallback manual)"
                    placeholderTextColor={t.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={modelId}
                    onChangeText={setModelId}
                  />
                )}
              </View>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: t.mutedForeground }]}>Display label</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground }]}
                  placeholder="Display label (e.g. Qwen local)"
                  placeholderTextColor={t.mutedForeground}
                  value={label}
                  onChangeText={setLabel}
                />
              </View>

              {!!error && <Text style={{ color: t.destructive, fontSize: 12 }}>{error}</Text>}

              <Pressable
                accessibilityRole="button"
                disabled={createMutation.isPending || !label.trim() || !baseUrl.trim() || !modelId.trim()}
                onPress={submit}
                style={({ pressed }) => [styles.connectBtn, { backgroundColor: t.primary, opacity: pressed || createMutation.isPending ? 0.8 : 1 }]}
              >
                {createMutation.isPending ? <ActivityIndicator color={t.primaryForeground} size="small" /> : <Text style={[styles.connectText, { color: t.primaryForeground }]}>Connect</Text>}
              </Pressable>
              <Text style={{ color: t.mutedForeground, fontSize: 11 }}>The model is verified against {"{base}/models"} on save. Local example: LM Studio → Developer → Start server.</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "center", padding: 16 },
  card: { borderRadius: 20, borderWidth: 1, overflow: "hidden", maxHeight: "88%" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700", flex: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  connCard: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  connHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  connLabel: { fontSize: 14, fontWeight: "600" },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  detailKey: { fontSize: 12, minWidth: 90 },
  detailVal: { fontSize: 12, flex: 1, textAlign: "right", fontFamily: "monospace" },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start", marginTop: 6 },
  form: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 10 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  label: { fontSize: 11, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  iconBtn: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  placeholder: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 42 },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 10 },
  modelList: { maxHeight: 160, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  modelItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  connectBtn: { borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  connectText: { fontSize: 14, fontWeight: "700" },
});

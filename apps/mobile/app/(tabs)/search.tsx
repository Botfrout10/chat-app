import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useChannels, useSearch } from "@/hooks/queries";
import { channelTitle } from "@/lib/channelTitle";
import { useChatStore } from "@/stores/chat";
import { useTheme } from "@/theme/useTheme";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export default function Search() {
  const t = useTheme();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [channelFilter, setChannelFilter] = useState<string | null>(null);

  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const channelsQuery = useChannels(activeWorkspaceId);
  const channels = channelsQuery.data ?? [];

  // debounce the actual query
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const resultsQuery = useSearch(debounced, channelFilter ?? undefined);
  const results = resultsQuery.data ?? [];
  const searching = q.trim().length > 0 && debounced !== q.trim();

  function openResult(channelId: string, messageAt: string) {
    void messageAt;
    const ch = channels.find((c) => c.id === channelId);
    router.push({
      pathname: "/channel/[id]",
      params: {
        id: channelId,
        name: ch ? channelTitle(ch) : "channel",
        type: ch?.type ?? "public",
      },
    });
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
      <View style={styles.header}>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground },
          ]}
          placeholder="Search messages…"
          placeholderTextColor={t.mutedForeground}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
        />
      </View>

      {/* channel scope filter chips */}
      {!!channels.length && (
        <View style={{ paddingHorizontal: 12 }}>
          <Text style={{ color: t.mutedForeground, fontSize: 11, fontWeight: "700", marginBottom: 4 }}>
            FILTER
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Chip label="All channels" active={channelFilter === null} onPress={() => setChannelFilter(null)} />
            {channels.slice(0, 8).map((c) => (
              <Chip
                key={c.id}
                label={channelTitle(c)}
                active={channelFilter === c.id}
                onPress={() => setChannelFilter(c.id)}
              />
            ))}
          </View>
        </View>
      )}

      {searching || resultsQuery.isFetching ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={t.primary} />
      ) : debounced && !results.length && !resultsQuery.isPending ? (
        <Text style={{ color: t.mutedForeground, textAlign: "center", marginTop: 32 }}>
          No results for “{debounced}”
        </Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              onPress={() => openResult(item.channelId, item.createdAt)}
            >
              <Text style={{ color: t.accent600, fontSize: 12, fontWeight: "700" }}>
                # {channelTitle(item.channel)}
              </Text>
              <Text style={{ color: t.foreground, fontSize: 14, marginTop: 2 }} numberOfLines={2}>
                {item.content}
              </Text>
              <Text style={{ color: t.mutedForeground, fontSize: 11, marginTop: 2 }}>
                {item.sender?.name ?? ""} · {timeAgo(item.createdAt)}
              </Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? t.primary : t.card,
          borderColor: active ? t.primary : t.border,
        },
      ]}
    >
      <Text style={{ color: active ? t.primaryForeground : t.mutedForeground, fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { padding: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
});

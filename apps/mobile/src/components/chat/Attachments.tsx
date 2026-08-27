import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "@/api/client";
import { useTheme } from "@/theme/useTheme";
import type { Attachment } from "@/types";

const IMAGE_RE = /^image\//;

/** Proxied GET via API — stable, no MinIO host/signature rewrite needed. */
export function useSignedUrl(key: string | null) {
  return useQuery({
    queryKey: ["attachment-raw", key],
    queryFn: () => api.rawUrl(key!),
    enabled: !!key,
    staleTime: 55 * 60 * 1000,
  });
}

/** Backwards compat — older code imported useSignedUrl expecting { url }. */
export function useRawUrl(key: string | null) {
  return useSignedUrl(key);
}

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <View style={styles.wrap}>
      {attachments.map((a) =>
        IMAGE_RE.test(a.mime) || /\.(png|jpe?g|gif|webp)$/i.test(a.filename) ? (
          <AttachmentImage key={a.id} attachment={a} />
        ) : (
          <AttachmentFile key={a.id} attachment={a} />
        ),
      )}
    </View>
  );
}

function AttachmentImage({ attachment }: { attachment: Attachment }) {
  const t = useTheme();
  const signed = useSignedUrl(attachment.key);
  // useSignedUrl now returns a plain string URL (proxied via API), not { url }
  const url = typeof signed.data === "string" ? (signed.data as string) : (signed.data as any)?.url ?? null;

  if (signed.isError) {
    return (
      <View style={[styles.imageWrap, { backgroundColor: t.muted, alignItems: "center", justifyContent: "center" }]}>
        <Ionicons name="alert-circle-outline" size={24} color={t.destructive} />
        <Text style={{ color: t.destructive, fontSize: 11, marginTop: 4 }}>Failed to load image</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => {
        if (url) void Linking.openURL(url);
      }}
      disabled={!url}
      style={[styles.imageWrap, { backgroundColor: t.muted }]}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={styles.image}
          resizeMode="cover"
          onError={(e) => console.warn("[AttachmentImage] load error", e.nativeEvent?.error ?? e)}
        />
      ) : (
        <View style={styles.loading}>
          <Ionicons name="image-outline" size={28} color={t.mutedForeground} />
          {signed.isFetching && <Text style={{ color: t.mutedForeground, fontSize: 10, marginTop: 4 }}>Loading…</Text>}
        </View>
      )}
    </Pressable>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentFile({ attachment }: { attachment: Attachment }) {
  const t = useTheme();
  const signed = useSignedUrl(attachment.key);
  const url = typeof signed.data === "string" ? (signed.data as string) : (signed.data as any)?.url ?? null;

  return (
    <Pressable
      onPress={() => {
        if (url) void Linking.openURL(url);
      }}
      style={[styles.fileChip, { backgroundColor: t.accent50, borderColor: t.border }]}
    >
      <Ionicons name="document-text-outline" size={20} color={t.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.fileName, { color: t.foreground }]} numberOfLines={1}>
          {attachment.filename}
        </Text>
        {!!attachment.size && (
          <Text style={[styles.fileSize, { color: t.mutedForeground }]}>
            {formatSize(attachment.size)}
          </Text>
        )}
      </View>
      <Ionicons name="download-outline" size={16} color={t.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 6 },
  imageWrap: {
    borderRadius: 14,
    overflow: "hidden",
    width: 220,
    height: 160,
  },
  image: { width: "100%", height: "100%" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileName: { fontSize: 14, fontWeight: "500" },
  fileSize: { fontSize: 11, marginTop: 1 },
});

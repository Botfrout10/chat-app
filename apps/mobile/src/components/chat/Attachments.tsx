import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "@/api/client";
import { useTheme } from "@/theme/useTheme";
import type { Attachment } from "@/types";

const IMAGE_RE = /^image\//;

/** Presigned GET URL for an attachment key (valid 1h server-side). */
export function useSignedUrl(key: string | null) {
  return useQuery({
    queryKey: ["signed", key],
    queryFn: () => api.signedUrl(key!),
    enabled: !!key,
    staleTime: 55 * 60 * 1000,
  });
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

  return (
    <Pressable
      onPress={() => {
        const url = signed.data?.url;
        if (url) void Linking.openURL(url);
      }}
      disabled={!signed.data}
      style={[styles.imageWrap, { backgroundColor: t.muted }]}
    >
      {signed.data?.url ? (
        <Image source={{ uri: signed.data.url }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={styles.loading}>
          <Ionicons name="image-outline" size={28} color={t.mutedForeground} />
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

  return (
    <Pressable
      onPress={() => {
        const url = signed.data?.url;
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

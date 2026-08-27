import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";

import { API_URL } from "@/api/client";
import { loadToken } from "@/lib/session";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";
import type { Attachment } from "@/types";

const IMAGE_RE = /^image\//;

/** Proxied GET via API — includes bearer token in query so both <Image> and Linking work without custom headers. */
export function useSignedUrl(key: string | null) {
  const { token } = useSession();
  return useQuery({
    queryKey: ["attachment-raw", key, token ?? "no-token"],
    queryFn: async () => {
      const t = token ?? (await loadToken());
      const base = `${API_URL}/api/attachments/${encodeURIComponent(key!)}/raw`;
      return t ? `${base}?token=${encodeURIComponent(t)}` : base;
    },
    enabled: !!key && !!token,
    staleTime: 55 * 60 * 1000,
  });
}

/** Backwards compat — older code imported useSignedUrl expecting { url }. */
export function useRawUrl(key: string | null) {
  return useSignedUrl(key);
}

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  const [lightbox, setLightbox] = useState<{ uri: string; name: string; mime: string } | null>(null);
  if (!attachments.length) return null;
  return (
    <>
      <View style={styles.wrap}>
        {attachments.map((a) =>
          IMAGE_RE.test(a.mime) || /\.(png|jpe?g|gif|webp)$/i.test(a.filename) ? (
            <AttachmentImage key={a.id} attachment={a} onOpen={(uri) => setLightbox({ uri, name: a.filename, mime: a.mime })} />
          ) : (
            <AttachmentFile key={a.id} attachment={a} onOpen={(uri) => setLightbox({ uri, name: a.filename, mime: a.mime })} />
          ),
        )}
      </View>
      <AttachmentLightbox
        visible={!!lightbox}
        uri={lightbox?.uri ?? null}
        name={lightbox?.name ?? ""}
        mime={lightbox?.mime ?? ""}
        onClose={() => setLightbox(null)}
      />
    </>
  );
}

function AttachmentImage({ attachment, onOpen }: { attachment: Attachment; onOpen: (uri: string) => void }) {
  const t = useTheme();
  const signed = useSignedUrl(attachment.key);
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
        if (url) onOpen(url);
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

function AttachmentFile({ attachment, onOpen }: { attachment: Attachment; onOpen: (uri: string) => void }) {
  const t = useTheme();
  const signed = useSignedUrl(attachment.key);
  const url = typeof signed.data === "string" ? (signed.data as string) : (signed.data as any)?.url ?? null;

  return (
    <Pressable
      onPress={() => {
        if (url) onOpen(url);
      }}
      disabled={!url}
      style={[styles.fileChip, { backgroundColor: t.accent50, borderColor: t.border }]}
    >
      <Ionicons name="document-text-outline" size={20} color={t.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.fileName, { color: t.foreground }]} numberOfLines={1}>
          {attachment.filename}
        </Text>
        {!!attachment.size && (
          <Text style={[styles.fileSize, { color: t.mutedForeground }]}>{formatSize(attachment.size)}</Text>
        )}
      </View>
      <Ionicons name={signed.isFetching ? "hourglass-outline" : "expand-outline"} size={16} color={t.mutedForeground} />
    </Pressable>
  );
}

function AttachmentLightbox({
  visible,
  uri,
  name,
  mime,
  onClose,
}: {
  visible: boolean;
  uri: string | null;
  name: string;
  mime: string;
  onClose: () => void;
}) {
  const t = useTheme();
  const isImage = /^image\//.test(mime) || /\.(png|jpe?g|gif|webp)$/i.test(name);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.lightboxBackdrop}>
        <View style={styles.lightboxHeader}>
          <Text style={[styles.lightboxTitle, { color: "#fff" }]} numberOfLines={1}>
            {name}
          </Text>
          <Pressable onPress={onClose} style={styles.lightboxClose} hitSlop={10}>
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
        </View>
        <Pressable style={styles.lightboxContent} onPress={onClose}>
          {isImage && uri ? (
            <ScrollView
              contentContainerStyle={styles.lightboxScroll}
              maximumZoomScale={3}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              centerContent
            >
              <Image source={{ uri }} style={styles.lightboxImage} resizeMode="contain" />
            </ScrollView>
          ) : (
            <View style={[styles.lightboxFile, { backgroundColor: t.card }]}>
              <Ionicons name="document-text-outline" size={48} color={t.primary} />
              <Text style={[styles.fileName, { color: t.foreground, marginTop: 12, textAlign: "center" }]}>{name}</Text>
              <Text style={{ color: t.mutedForeground, fontSize: 12, marginTop: 4 }}>{mime}</Text>
              <Text style={{ color: t.mutedForeground, fontSize: 11, marginTop: 8, textAlign: "center" }}>
                Preview is shown in-app. Use the system share sheet or download if needed.
              </Text>
            </View>
          )}
        </Pressable>
      </View>
    </Modal>
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
  lightboxBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)" },
  lightboxHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
  },
  lightboxTitle: { flex: 1, fontSize: 14, fontWeight: "600", marginRight: 12 },
  lightboxClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  lightboxContent: { flex: 1, justifyContent: "center", alignItems: "center" },
  lightboxScroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", minHeight: "100%" },
  lightboxImage: { width: 360, height: 480, maxWidth: "96%", maxHeight: "80%" },
  lightboxFile: { margin: 16, borderRadius: 16, padding: 24, alignItems: "center", minWidth: 260 },
});

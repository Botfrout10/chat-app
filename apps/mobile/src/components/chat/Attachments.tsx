import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { API_URL } from "@/api/client";
import { loadToken, useSession } from "@/lib/session";
import { useTheme } from "@/theme/useTheme";
import type { Attachment } from "@/types";

const IMAGE_RE = /^image\//;

/**
 * Proxied raw via API — web uses cookies, mobile uses bearer.
 * React-Native <Image> on Android (Fresco) ignores custom `headers`, and some
 * expo-file-system versions strip them, so we send BOTH: ?token= in the URL
 * (required for Android) and Authorization header (used on iOS/web).
 * Server `getSessionUser` in apps/api/src/index.ts:81 accepts either.
 */
export function useSignedUrl(key: string | null) {
  const { token } = useSession();
  return useQuery<{ uri: string; headers: Record<string, string> }>({
    queryKey: ["attachment-raw", key, token ?? "no-token"],
    queryFn: async () => {
      const t = token ?? (await loadToken());
      const base = `${API_URL}/api/attachments/${encodeURIComponent(key!)}/raw`;
      const uri = t ? `${base}?token=${encodeURIComponent(t)}` : base;
      return { uri, headers: t ? { Authorization: `Bearer ${t}` } : ({} as Record<string, string>) };
    },
    enabled: !!key,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Backwards compat — older code imported useSignedUrl expecting { url }. */
export function useRawUrl(key: string | null) {
  return useSignedUrl(key);
}

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  const [lightbox, setLightbox] = useState<{ uri: string; headers?: Record<string, string>; name: string; mime: string } | null>(null);
  if (!attachments.length) return null;
  return (
    <>
      <View style={styles.wrap}>
        {attachments.map((a) =>
          IMAGE_RE.test(a.mime) || /\.(png|jpe?g|gif|webp)$/i.test(a.filename) ? (
            <AttachmentImage
              key={a.id}
              attachment={a}
              onOpen={(uri, headers) => setLightbox({ uri, headers, name: a.filename, mime: a.mime })}
            />
          ) : (
            <AttachmentFile key={a.id} attachment={a} onOpen={(uri, headers) => setLightbox({ uri, headers, name: a.filename, mime: a.mime })} />
          ),
        )}
      </View>
      <AttachmentLightbox
        visible={!!lightbox}
        uri={lightbox?.uri ?? null}
        headers={lightbox?.headers}
        name={lightbox?.name ?? ""}
        mime={lightbox?.mime ?? ""}
        onClose={() => setLightbox(null)}
      />
    </>
  );
}

function AttachmentImage({ attachment, onOpen }: { attachment: Attachment; onOpen: (uri: string, headers?: Record<string, string>) => void }) {
  const t = useTheme();
  const signed = useSignedUrl(attachment.key);
  const url = signed.data?.uri ?? null;
  const headers = signed.data?.headers;

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
        if (url) onOpen(url, headers);
      }}
      disabled={!url}
      style={[styles.imageWrap, { backgroundColor: t.muted }]}
    >
      {url ? (
        <Image
          source={headers && Object.keys(headers).length ? { uri: url, headers } as any : { uri: url }}
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

function AttachmentFile({ attachment, onOpen }: { attachment: Attachment; onOpen: (uri: string, headers?: Record<string, string>) => void }) {
  const t = useTheme();
  const signed = useSignedUrl(attachment.key);
  const url = signed.data?.uri ?? null;
  const headers = signed.data?.headers;

  return (
    <Pressable
      onPress={() => {
        if (url) onOpen(url, headers);
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

async function downloadAndOpen(uri: string, filename: string, mime: string, headers?: Record<string, string>) {
  try {
    // sanitize filename for local FS (no path separators)
    const safeName = filename.replace(/[\\/]/g, "_") || "file";
    const cacheDir = (FileSystemLegacy as any).cacheDirectory as string | null;
    const target = cacheDir ? `${cacheDir}${safeName}` : safeName;
    const dl: any = await (FileSystemLegacy as any).downloadAsync(uri, target, { headers: headers ?? {} });
    // dl = { uri, status, headers, md5 } — if server returned 401 JSON, dl.status is 401
    // and the file on disk contains {"error":"Unauthorized"} which Adobe would call "damaged".
    if (typeof dl?.status === "number" && (dl.status < 200 || dl.status >= 300)) {
      // try to read the JSON error body that was saved as the file
      let body = "";
      try {
        body = await (FileSystemLegacy as any).readAsStringAsync(dl.uri);
      } catch {}
      let msg = body || `Request failed ${dl.status}`;
      try {
        const parsed = JSON.parse(body);
        msg = parsed?.error ?? parsed?.message ?? msg;
      } catch {}
      // clean up the bogus file so re-download can succeed
      try {
        await (FileSystemLegacy as any).deleteAsync(dl.uri, { idempotent: true });
      } catch {}
      throw new Error(msg.slice(0, 200) || `Download failed (${dl.status})`);
    }
    const ct = dl?.headers?.["Content-Type"] ?? dl?.headers?.["content-type"] ?? "";
    if (ct.includes("application/json")) {
      let body = "";
      try {
        body = await (FileSystemLegacy as any).readAsStringAsync(dl.uri);
      } catch {}
      try {
        const parsed = JSON.parse(body);
        const err = parsed?.error ?? parsed?.message ?? body;
        if (err) throw new Error(String(err).slice(0, 200));
      } catch (e) {
        if (e instanceof Error && !body.includes("error")) throw e;
        if (body) throw new Error(body.slice(0, 200));
      }
      throw new Error("Download returned unexpected JSON — not a file");
    }
    const available = await Sharing.isAvailableAsync();
    if (available) {
      await Sharing.shareAsync(dl.uri, { mimeType: mime, dialogTitle: filename, UTI: mime });
    } else {
      Alert.alert("Downloaded", `File saved to ${dl.uri}`);
    }
  } catch (e) {
    Alert.alert("Open failed", e instanceof Error ? e.message : String(e));
  }
}

function AttachmentLightbox({
  visible,
  uri,
  headers,
  name,
  mime,
  onClose,
}: {
  visible: boolean;
  uri: string | null;
  headers?: Record<string, string>;
  name: string;
  mime: string;
  onClose: () => void;
}) {
  const t = useTheme();
  const isImage = /^image\//.test(mime) || /\.(png|jpe?g|gif|webp)$/i.test(name);
  const [downloading, setDownloading] = useState(false);
  async function handleOpenFile() {
    if (!uri) return;
    setDownloading(true);
    try {
      await downloadAndOpen(uri, name, mime, headers);
    } finally {
      setDownloading(false);
    }
  }
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
              <Image source={headers && Object.keys(headers).length ? ({ uri, headers } as any) : { uri }} style={styles.lightboxImage} resizeMode="contain" />
            </ScrollView>
          ) : (
            <View style={[styles.lightboxFile, { backgroundColor: t.card }]}>
              <Ionicons name="document-text-outline" size={48} color={t.primary} />
              <Text style={[styles.fileName, { color: t.foreground, marginTop: 12, textAlign: "center" }]}>{name}</Text>
              <Text style={{ color: t.mutedForeground, fontSize: 12, marginTop: 4 }}>{mime}</Text>
              <Pressable
                onPress={handleOpenFile}
                disabled={!uri || downloading}
                style={[styles.openBtn, { backgroundColor: t.primary, opacity: !uri || downloading ? 0.6 : 1 }]}
              >
                <Ionicons name={downloading ? "hourglass-outline" : "open-outline"} size={16} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>{downloading ? "Downloading…" : "Download & Open"}</Text>
              </Pressable>
              <Text style={{ color: t.mutedForeground, fontSize: 11, marginTop: 8, textAlign: "center" }}>
                Opens with your system file viewer.
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
  openBtn: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
});

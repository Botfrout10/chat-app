import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
// ensure expo-blob polyfills global Blob so fetch().blob() is efficient (removes RN warning)
import "expo-blob";

import { api, rewriteAssetUrl } from "@/api/client";

export type PickedFile = {
  uri: string;
  filename: string;
  mime: string;
  size: number;
};

export type UploadedMeta = {
  key: string;
  filename: string;
  mime: string;
  size: number;
};

const MAX_BYTES = 25 * 1024 * 1024;

function extToMime(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    default:
      return null;
  }
}

export async function pickImage(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Photo library permission denied");

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
  });
  if (result.canceled || !result.assets[0]) return null;
  const a = result.assets[0];
  const filename = a.fileName ?? a.uri.split("/").pop() ?? "photo.jpg";
  return {
    uri: a.uri,
    filename,
    mime: a.mimeType ?? extToMime(filename) ?? "image/jpeg",
    size: a.fileSize ?? 0,
  };
}

export async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({});
  if (result.canceled || !result.assets?.[0]) return null;
  const a = result.assets[0];
  return {
    uri: a.uri,
    filename: a.name,
    mime: a.mimeType ?? extToMime(a.name) ?? "application/octet-stream",
    size: a.size ?? 0,
  };
}

/** presign → PUT the raw bytes to MinIO → return metadata for sendMessage(). */
export async function uploadAttachment(file: PickedFile): Promise<UploadedMeta> {
  if (file.size > MAX_BYTES) throw new Error("Files are limited to 25 MB");
  const presigned = await api.presign({
    filename: file.filename,
    mime: file.mime,
    // API requires size > 0; some pickers can't stat — fall back to 1
    size: Math.max(file.size, 1),
  });

  const putUrl = rewriteAssetUrl(presigned.url);

  // Primary: expo-file-system/legacy uploadAsync handles content:// on Android efficiently
  // (fetch(file.uri).blob() copies via base64 and triggers RN warning).
  try {
    const result = await (FileSystemLegacy as any).uploadAsync(putUrl, file.uri, {
      httpMethod: "PUT",
      uploadType: (FileSystemLegacy as any).FileSystemUploadType?.BINARY_CONTENT ?? 0,
      headers: { "Content-Type": file.mime },
    });
    if (result.status < 200 || result.status >= 300) throw new Error(`Upload failed (${result.status}) ${result.body?.slice(0, 120) ?? ""}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Upload failed")) throw e;
    // Fallback: fetch blob PUT (expo-blob makes it efficient, but less ideal for content://)
    try {
      const blob = await (await fetch(file.uri)).blob();
      const res = await fetch(putUrl, {
        method: "PUT",
        headers: { "Content-Type": file.mime },
        body: blob as any,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Upload failed (${res.status}) ${t.slice(0, 120)}`);
      }
    } catch (inner) {
      throw inner instanceof Error ? inner : new Error(String(e));
    }
  }

  return {
    key: presigned.key,
    filename: file.filename,
    mime: file.mime,
    size: Math.max(file.size, 1),
  };
}

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { env } from "./env.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function keyBytes(): Buffer {
  const secret = env.LLM_KEY_ENCRYPTION_KEY || env.BETTER_AUTH_SECRET;
  // derive 32-byte key via SHA-256 (stable regardless of secret length)
  return createHash("sha256").update(secret).digest();
}

export function encryptApiKey(plain: string): string {
  const key = keyBytes();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv:tag:ciphertext all base64url concatenated
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptApiKey(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    const [ivB64, tagB64, dataB64] = encrypted.split(":");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const key = keyBytes();
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

export function apiKeyHint(plain: string): string {
  if (!plain) return "";
  const t = plain.trim();
  if (t.length <= 4) return "••••";
  return `••••${t.slice(-4)}`;
}

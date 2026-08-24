export function encodeCursor(id: string) {
  return Buffer.from(id).toString("base64url");
}
export function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return cursor;
  }
}

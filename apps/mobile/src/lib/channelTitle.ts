import type { Channel } from "@/types";

/** Display title for a channel row/screen header. */
export function channelTitle(c: Channel): string {
  if (c.type === "public" || c.type === "private") return c.name;
  if (Array.isArray(c.dmPeer)) {
    return c.dmPeer.map((p) => p.name).join(", ") || c.name;
  }
  return c.dmPeer?.name ?? c.name;
}

export function isDmLike(c: Channel): boolean {
  return c.type === "dm" || c.type === "group";
}

export function dmPeerId(c: Channel): string | null {
  if (!Array.isArray(c.dmPeer) && c.dmPeer) return c.dmPeer.id;
  return null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

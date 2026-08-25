import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Attachments } from "@/components/chat/Attachments";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import { useTheme } from "@/theme/useTheme";
import type { Message, User } from "@/types";

function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({
  message,
  me,
  firstOfGroup,
  onLongPress,
}: {
  message: Message;
  me: User | null;
  firstOfGroup: boolean;
  onLongPress?: (m: Message) => void;
}) {
  const t = useTheme();
  const own = me?.id === message.senderId;
  const [showThinking, setShowThinking] = useState(false);

  if (message.deletedAt) {
    return (
      <View style={[styles.row, own && styles.rowOwn]}>
        <Text style={[styles.tombstone, { color: t.mutedForeground }]}>message deleted</Text>
      </View>
    );
  }

  return (
    <Pressable
      onLongPress={() => onLongPress?.(message)}
      delayLongPress={250}
      style={({ pressed }) => [
        styles.row,
        own && styles.rowOwn,
        pressed ? { opacity: 0.75 } : null,
      ]}
    >
      <View style={[styles.bubble, { backgroundColor: own ? t.primary : t.card }, !own && { borderWidth: 1, borderColor: t.border }]}>
        {!own && firstOfGroup && (
          <Text style={[styles.senderName, { color: t.accent600 }]}>{message.sender?.name ?? "Unknown"}</Text>
        )}
        {!!message.parentId && (
          <View style={[styles.replyBar, { borderLeftColor: own ? t.accent300 : t.accent500 }]}>
            <Text style={{ color: own ? t.accent50 : t.mutedForeground, fontSize: 11 }} numberOfLines={1}>
              replied in thread
            </Text>
          </View>
        )}
        {!!message.reasoning && (
          <View style={[styles.thinking, own && { backgroundColor: "rgba(255,255,255,0.12)" }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowThinking((v) => !v)}
              style={styles.thinkingHeader}
              hitSlop={6}
            >
              <Text style={[styles.thinkingLabel, { color: own ? t.accent300 : t.mutedForeground }]}>
                {showThinking ? "▾" : "▸"} 🧠 Thinking
              </Text>
            </Pressable>
            {showThinking && (
              <Text style={[styles.thinkingBody, { color: own ? t.accent50 : t.mutedForeground }]} selectable>
                {message.reasoning}
              </Text>
            )}
          </View>
        )}
        <MessageMarkdown content={message.content} own={own} />
        {message.editedAt ? (
          <Text style={[styles.edited, { color: own ? t.accent100 : t.mutedForeground, alignSelf: "flex-end" }]}> (edited)</Text>
        ) : null}

        <Attachments attachments={message.attachments ?? []} />

        {!!message.reactions?.length && (
          <View style={styles.reactions}>
            {groupReactions(message.reactions, me?.id).map((r) => (
              <View
                key={r.emoji}
                style={[
                  styles.chip,
                  {
                    backgroundColor: own ? t.primaryHover : t.accent50,
                    borderColor: r.mine ? t.accent500 : "transparent",
                  },
                ]}
              >
                <Text style={{ fontSize: 12 }}>{r.emoji}</Text>
                <Text style={{ fontSize: 11, color: own ? t.accent50 : t.mutedForeground }}>
                  {r.count}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.time, { color: own ? t.accent100 : t.mutedForeground }]}>
          {timeOf(message.createdAt)}
        </Text>
      </View>
    </Pressable>
  );
}

function groupReactions(
  reactions: Message["reactions"],
  myId?: string,
): { emoji: string; count: number; mine: boolean }[] {
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const cur = map.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1;
    if (myId && r.userId === myId) cur.mine = true;
    map.set(r.emoji, cur);
  }
  return [...map.entries()].map(([emoji, v]) => ({ emoji, ...v }));
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    paddingVertical: 2,
    flexDirection: "row",
  },
  rowOwn: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "82%",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  senderName: { fontSize: 12, fontWeight: "700", marginBottom: 3 },
  replyBar: {
    borderLeftWidth: 2,
    paddingLeft: 6,
    marginBottom: 4,
  },
  content: { fontSize: 15, lineHeight: 21 },
  thinking: {
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.04)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  thinkingHeader: { paddingVertical: 2 },
  thinkingLabel: { fontSize: 11, fontWeight: "600" },
  thinkingBody: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  edited: { fontSize: 11, opacity: 0.7 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  time: { fontSize: 10, alignSelf: "flex-end", marginTop: 2 },
  tombstone: {
    fontStyle: "italic",
    fontSize: 13,
    paddingVertical: 8,
    marginHorizontal: 12,
  },
});

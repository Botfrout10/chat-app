import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getSocket } from "@/lib/socket";
import { useTheme } from "@/theme/useTheme";

const MAX_LEN = 4000;

export type ComposerState =
  | { kind: "idle" }
  | { kind: "reply"; parentId: string; parentPreview: string }
  | { kind: "edit"; messageId: string; initial: string };

export function MessageComposer({
  channelId,
  disabled,
  state,
  onStateCleared,
  onSend,
  onEditSave,
  onAttach,
  pendingAttachments,
  onRemoveAttachment,
  uploading,
  members,
  llmConnections,
  agents,
  restoreDraft,
  onRestoreConsumed,
}: {
  channelId: string;
  disabled?: boolean;
  state: ComposerState;
  onStateCleared: () => void;
  onSend: (content: string) => Promise<unknown>;
  onEditSave: (messageId: string, content: string) => Promise<unknown>;
  onAttach?: () => void;
  pendingAttachments?: string[];
  onRemoveAttachment?: (index: number) => void;
  uploading?: boolean;
  members?: { id: string; name: string; email?: string }[];
  llmConnections?: { id: string; label: string; mentionName: string }[];
  agents?: { id: string; name: string; mentionName?: string }[];
  restoreDraft?: string | null;
  onRestoreConsumed?: () => void;
}) {
  const t = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const typingRef = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevEdit = useRef<string | null>(null);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const [slashQ, setSlashQ] = useState<string | null>(null);

  // seed/clear composer text around edit mode
  useEffect(() => {
    if (state.kind === "edit") {
      if (state.messageId !== prevEdit.current) setText(state.initial);
      prevEdit.current = state.messageId;
    } else {
      if (prevEdit.current) setText("");
      prevEdit.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // restore draft when LLM fails (keep in input)
  useEffect(() => {
    if (restoreDraft) {
      setText(restoreDraft);
      onRestoreConsumed?.();
    }
  }, [restoreDraft, onRestoreConsumed]);

  function emitTyping(isTyping: boolean) {
    const socket = getSocket();
    socket.emit(isTyping ? "typing:start" : "typing:stop", { channelId });
    typingRef.current = isTyping;
  }

  function handleChange(newText: string) {
    setText(newText);
    // @mention autocomplete: detect trailing @token
    const m = /@([\p{L}\p{N}_.-]*)$/u.exec(newText);
    if (m && (members?.length || llmConnections?.length || agents?.length)) setMentionQ(m[1].toLowerCase());
    else setMentionQ(null);
    const sm = /\/(\w*)$/.exec(newText);
    if (sm && newText.trimStart().startsWith("/")) setSlashQ(sm[1].toLowerCase());
    else setSlashQ(null);
    if (!typingRef.current && newText.length > 0) emitTyping(true);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      if (typingRef.current) emitTyping(false);
    }, 2500);
  }

  const mentionMatches = (() => {
    if (mentionQ === null) return [];
    const q = mentionQ;
    const out: { key: string; label: string; sub?: string; isModel?: boolean; isAgent?: boolean; mentionName?: string; name: string }[] = [];
    for (const mm of members ?? []) {
      if (mm.name.toLowerCase().startsWith(q) || (mm.email ?? "").toLowerCase().split("@")[0].startsWith(q) || (mm.email ?? "").toLowerCase().startsWith(q)) {
        out.push({ key: mm.id, label: mm.name, sub: mm.email, name: mm.name });
      }
    }
    for (const c of llmConnections ?? []) {
      if (c.label.toLowerCase().startsWith(q) || c.mentionName.toLowerCase().startsWith(q)) {
        out.push({ key: c.id, label: c.label, sub: `@${c.mentionName}`, isModel: true, mentionName: c.mentionName, name: c.label });
      }
    }
    for (const a of agents ?? []) {
      const mn = (a.mentionName ?? a.name.toLowerCase().replace(/\s+/g, "-")).toLowerCase();
      if (a.name.toLowerCase().startsWith(q) || mn.startsWith(q)) {
        out.push({ key: a.id, label: a.name, sub: `@${mn}`, isAgent: true, mentionName: mn, name: a.name });
      }
    }
    return out.slice(0, 6);
  })();
  const SLASH_COMMANDS = [
    { id: "new-session", label: "/new-session", desc: "New agent session" },
    { id: "skills", label: "/skills", desc: "Manage skills" },
    { id: "clear", label: "/clear-queue", desc: "Clear queued" },
  ];
  const slashMatches = (() => {
    if (slashQ === null) return [];
    return SLASH_COMMANDS.filter((c) => c.label.toLowerCase().startsWith("/" + slashQ)).slice(0, 5);
  })();

  function pickMention(item: { name: string; mentionName?: string; isModel?: boolean; isAgent?: boolean }) {
    const token = item.isModel || item.isAgent ? item.mentionName! : item.name;
    setText((prev) => prev.replace(/@([\p{L}\p{N}_.-]*)$/u, `@${token} `));
    setMentionQ(null);
  }
  function pickSlash(item: { label: string }) {
    setText((prev) => prev.replace(/\/\w*$/, item.label + " "));
    setSlashQ(null);
  }

  async function submit() {
    const content = text.trim();
    if (!content || busy || disabled) return;
    setBusy(true);
    setMentionQ(null);
    try {
      if (state.kind === "edit") {
        await onEditSave(state.messageId, content);
        onStateCleared();
        setText("");
      } else {
        await onSend(content);
        setText("");
      }
    } finally {
      if (typingRef.current) emitTyping(false);
      setBusy(false);
    }
  }

  function clearReply() {
    onStateCleared();
  }

  return (
    <View style={[styles.wrap, { backgroundColor: t.background, borderTopColor: t.border }]}>
      {mentionQ !== null && mentionMatches.length > 0 && (
        <View style={[styles.mentionBox, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.mentionTitle, { color: t.mutedForeground }]}>MEMBERS</Text>
          {mentionMatches.map((m) => (
            <Pressable
              key={m.key}
              onPress={() => pickMention(m)}
              style={({ pressed }) => [styles.mentionRow, { backgroundColor: pressed ? t.muted : "transparent" }]}
            >
              <View style={[styles.mentionAvatar, { backgroundColor: t.primary }]}>
                <Text style={{ color: t.primaryForeground, fontSize: 10, fontWeight: "700" }}>
                  {m.label.slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.mentionLabel, { color: t.foreground }]}>{m.label}</Text>
              {!!m.sub && (
                <Text style={[styles.mentionSub, { color: t.mutedForeground }]} numberOfLines={1}>
                  {m.sub}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
      {slashQ !== null && slashMatches.length > 0 && (
        <View style={[styles.mentionBox, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.mentionTitle, { color: t.mutedForeground }]}>COMMANDS</Text>
          {slashMatches.map((m) => (
            <Pressable key={m.id} onPress={() => pickSlash(m)} style={({ pressed }) => [styles.mentionRow, { backgroundColor: pressed ? t.muted : "transparent" }]}>
              <Text style={[styles.mentionLabel, { color: t.foreground }]}>{m.label}</Text>
              <Text style={[styles.mentionSub, { color: t.mutedForeground }]}>{m.desc}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!!pendingAttachments?.length && (
        <View style={styles.attachRow}>
          {pendingAttachments.map((name, i) => (
            <Pressable
              key={`${name}-${i}`}
              onPress={() => onRemoveAttachment?.(i)}
              style={[styles.attachChip, { backgroundColor: t.accent50, borderColor: t.border }]}
            >
              <Text style={{ color: t.accent700, fontSize: 12, maxWidth: 140 }} numberOfLines={1}>
                {name}
              </Text>
              <Ionicons name="close-circle" size={14} color={t.mutedForeground} />
            </Pressable>
          ))}
        </View>
      )}
      {state.kind === "reply" && (
        <View style={[styles.contextBar, { backgroundColor: t.muted }]}>
          <Ionicons name="arrow-undo" size={13} color={t.mutedForeground} />
          <Text style={{ flex: 1, color: t.mutedForeground, fontSize: 12 }} numberOfLines={1}>
            {state.parentPreview}
          </Text>
          <Pressable onPress={clearReply} hitSlop={8}>
            <Ionicons name="close" size={15} color={t.mutedForeground} />
          </Pressable>
        </View>
      )}
      {state.kind === "edit" && (
        <View style={[styles.contextBar, { backgroundColor: t.accent50 }]}>
          <Ionicons name="pencil" size={13} color={t.accent600} />
          <Text style={{ flex: 1, color: t.accent700, fontSize: 12 }}>editing message</Text>
          <Pressable onPress={clearReply} hitSlop={8}>
            <Ionicons name="close" size={15} color={t.accent700} />
          </Pressable>
        </View>
      )}

      <View style={styles.inputRow}>
        {!!onAttach && state.kind === "idle" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach file"
            onPress={() => {
              Keyboard.dismiss();
              onAttach();
            }}
            disabled={disabled || uploading}
            style={[styles.attachBtn, { backgroundColor: t.muted, opacity: uploading ? 0.5 : 1 }]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={t.primary} />
            ) : (
              <Ionicons name="add-circle-outline" size={24} color={t.primary} />
            )}
          </Pressable>
        )}
        <TextInput
          style={[
            styles.input,
            { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground },
          ]}
          placeholder="Message…"
          placeholderTextColor={t.mutedForeground}
          value={text}
          onChangeText={handleChange}
          // web (react-native-web) physical keyboard via browser may fire onChange with target.value
          onChange={(e: unknown) => {
            if (Platform.OS !== "web") return;
            const v = (e as { nativeEvent?: { text?: string }; target?: { value?: string } })?.nativeEvent?.text ??
              (e as { target?: { value?: string } })?.target?.value;
            if (typeof v === "string" && v !== text) handleChange(v);
          }}
          onBlur={() => {
            if (stopTimer.current) clearTimeout(stopTimer.current);
            if (typingRef.current) emitTyping(false);
          }}
          multiline
          maxLength={MAX_LEN}
          autoCorrect
          keyboardType="default"
          editable={!disabled}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!text.trim() || busy || disabled}
          onPress={() => void submit()}
          style={[
            styles.sendBtn,
            { backgroundColor: t.primary, opacity: !text.trim() || busy ? 0.4 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={t.primaryForeground} />
          ) : (
            <Ionicons name={state.kind === "edit" ? "checkmark" : "send"} size={17} color={t.primaryForeground} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
  mentionBox: {
    marginHorizontal: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  mentionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  mentionRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  mentionAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  mentionLabel: { fontSize: 14, fontWeight: "500", flex: 1 },
  mentionSub: { fontSize: 12, maxWidth: 140 },
  contextBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  attachRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  attachChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 120,
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});

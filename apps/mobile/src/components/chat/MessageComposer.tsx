import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
}) {
  const t = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const typingRef = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevEdit = useRef<string | null>(null);

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

  function emitTyping(isTyping: boolean) {
    const socket = getSocket();
    socket.emit(isTyping ? "typing:start" : "typing:stop", { channelId });
    typingRef.current = isTyping;
  }

  function handleChange(newText: string) {
    setText(newText);
    if (!typingRef.current && newText.length > 0) emitTyping(true);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      if (typingRef.current) emitTyping(false);
    }, 2500);
  }

  async function submit() {
    const content = text.trim();
    if (!content || busy || disabled) return;
    setBusy(true);
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
            onPress={onAttach}
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
          onBlur={() => {
            if (stopTimer.current) clearTimeout(stopTimer.current);
            if (typingRef.current) emitTyping(false);
          }}
          multiline
          maxLength={MAX_LEN}
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

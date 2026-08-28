import { Keyboard, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/theme/useTheme";
import type { Message, User } from "@/types";

export type Action = {
  key: string;
  label: string;
  icon?: string;
  destructive?: boolean;
  onPress: () => void;
};

/**
 * Cross-platform bottom action sheet (RN's ActionSheetIOS is iOS-only).
 * Backdrop tap dismisses.
 */
export function ActionSheet({
  visible,
  onClose,
  actions,
  header,
}: {
  visible: boolean;
  onClose: () => void;
  actions: Action[];
  header?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.flex} onPress={onClose} accessibilityLabel="Dismiss menu" />
        <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: t.card }]}>
          {header}
          {actions.map((a) => (
            <Pressable
              key={a.key}
              onPress={() => {
                onClose();
                // small delay so modal close animation starts
                setTimeout(a.onPress, 80);
              }}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? t.muted : "transparent" },
              ]}
            >
              <Text style={[styles.label, { color: a.destructive ? t.destructive : t.foreground }]}>
                {a.label}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={[styles.row, styles.cancel]}>
            <Text style={[styles.cancelLabel, { color: t.mutedForeground }]}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** Small header used above quick-reaction actions in message sheets. */
export function QuickReactions({
  me,
  onPick,
}: {
  me: User | null;
  onPick: (emoji: string) => void;
}) {
  const t = useTheme();
  void me;
  return (
    <View style={styles.reactionsRow}>
      {QUICK_REACTIONS.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => onPick(emoji)}
          style={({ pressed }) => [styles.reactionBtn, { backgroundColor: pressed ? t.accent100 : t.muted }]}
        >
          <Text style={{ fontSize: 22 }}>{emoji}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"] as const;

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#00000055",
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#00000055",
    justifyContent: "flex-end",
    zIndex: 50,
  },
  flex: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 28,
    paddingTop: 8,
  },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  label: { fontSize: 16, fontWeight: "500" },
  cancel: { marginTop: 4 },
  cancelLabel: { fontSize: 15, textAlign: "center", fontWeight: "600" },
  reactionsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  reactionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});

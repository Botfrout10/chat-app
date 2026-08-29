import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { useTheme } from "@/theme/useTheme";

export function InviteMemberModal({
  visible,
  workspaceId,
  onClose,
}: {
  visible: boolean;
  workspaceId: string | null | undefined;
  onClose: () => void;
}) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const q = query.trim();
    if (!q) return;
    if (!workspaceId) {
      setError("Select a workspace first");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const added: any = await api.addMember(workspaceId, q);
      setSuccess(`Added ${added.name ?? q} to workspace`);
      queryClient.invalidateQueries({ queryKey: ["members", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setTimeout(() => {
        setQuery("");
        setSuccess(null);
        onClose();
      }, 600);
    } catch (e: any) {
      const raw = e instanceof Error ? e.message : String(e ?? "");
      let body = raw;
      try {
        const parsed = JSON.parse(raw);
        body = parsed?.error ?? raw;
      } catch {}
      const isNotFound = body.includes("USER_NOT_FOUND") || /No registered user/i.test(body);
      const isAlreadyMember = /already a member/i.test(body);
      if (isAlreadyMember) {
        setError(body.slice(0, 200));
        return;
      }
      if (isNotFound && q.includes("@")) {
        // fallback: invite link for unknown email
        try {
          const inv: any = await api.invite(workspaceId, q, "member");
          const link = inv.inviteUrl ?? `/invite/${inv.token}`;
          const fullLink = link.startsWith("http") ? link : `${link}`;
          setSuccess(`Invite created — share: ${fullLink}`);
          // also try to notify via Alert for copy
          Alert.alert("Invite created", `Share this link:\n${fullLink}`);
          setQuery("");
          // keep modal open briefly to show success, optionally close
          setTimeout(() => {
            setSuccess(null);
            onClose();
          }, 1200);
          queryClient.invalidateQueries({ queryKey: ["workspaces"] });
        } catch (e2: any) {
          setError((e2 instanceof Error ? e2.message : String(e2)).slice(0, 200));
        }
        return;
      }
      if (isNotFound) {
        setError(`No user “${q}” found — ask them to sign up first.`);
        return;
      }
      setError(body.slice(0, 200) || "Failed to add member");
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (busy) return;
    setError(null);
    setSuccess(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]} onPress={() => {}}>
          <Text style={[styles.title, { color: t.foreground }]}>Invite members</Text>
          <Text style={{ color: t.mutedForeground, fontSize: 12, marginBottom: 4 }}>
            Add a registered user by exact name or email. Unknown emails get an invite link instead.
          </Text>
          {!workspaceId && (
            <Text style={{ color: t.destructive, fontSize: 12, marginBottom: 8 }}>
              No workspace selected — create or switch to a workspace first.
            </Text>
          )}
          <TextInput
            style={[styles.input, { backgroundColor: t.input, borderColor: t.inputBorder, color: t.foreground }]}
            placeholder="Name or email"
            placeholderTextColor={t.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submit}
            returnKeyType="done"
          />
          {!!error && <Text style={{ color: t.destructive, fontSize: 12 }}>{error}</Text>}
          {!!success && <Text style={{ color: t.success, fontSize: 12 }}>{success}</Text>}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <Pressable
              onPress={handleClose}
              disabled={busy}
              style={({ pressed }) => [styles.cancelBtn, { borderColor: t.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.cancelText, { color: t.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy || !query.trim() || !workspaceId}
              onPress={submit}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: t.primary, opacity: pressed || busy || !query.trim() || !workspaceId ? 0.7 : 1 },
              ]}
            >
              {busy ? <ActivityIndicator color={t.primaryForeground} size="small" /> : <Text style={[styles.primaryText, { color: t.primaryForeground }]}>Add member</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#00000066",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: { borderRadius: 20, padding: 16, width: "90%", maxWidth: 420, gap: 8, borderWidth: 1 },
  title: { fontSize: 17, fontWeight: "700", marginBottom: 2 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  primaryBtn: { flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 42 },
  primaryText: { fontSize: 15, fontWeight: "700" },
  cancelBtn: { flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 42, borderWidth: 1 },
  cancelText: { fontSize: 15, fontWeight: "600" },
});

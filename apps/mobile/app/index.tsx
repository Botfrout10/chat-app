import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

export default function Index() {
  const t = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: t.background }]}>
      <Text style={[styles.title, { color: t.primary }]}>Pulse</Text>
      <Text style={[styles.subtitle, { color: t.mutedForeground }]}>Mobile client — scaffolding…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 40,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 14,
  },
});

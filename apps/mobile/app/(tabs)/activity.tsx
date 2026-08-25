import { Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

export default function ActivityPlaceholder() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: t.mutedForeground }}>Activity — coming soon</Text>
    </View>
  );
}

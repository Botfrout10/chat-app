import { Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

export default function SearchPlaceholder() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: t.mutedForeground }}>Search — coming soon</Text>
    </View>
  );
}

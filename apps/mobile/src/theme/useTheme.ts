import { useColorScheme } from "react-native";

import { dark, light, type Palette } from "./tokens";
import { useUiStore } from "@/stores/ui";

/**
 * Resolves the active palette. When the user's choice is "system" we follow
 * the OS setting (web's next-themes default); otherwise the explicit pick wins.
 */
export function useTheme(): Palette {
  const mode = useUiStore((s) => s.theme);
  const system = useColorScheme();
  const resolved = mode === "system" ? system ?? "light" : mode;
  return resolved === "dark" ? dark : light;
}

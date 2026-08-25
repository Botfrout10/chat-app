import { useColorScheme } from "react-native";
import { dark, light, type Palette } from "./tokens";

export function useTheme(): Palette {
  const scheme = useColorScheme();
  return scheme === "dark" ? dark : light;
}

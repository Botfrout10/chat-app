import { Platform } from "react-native";
import Markdown from "react-native-markdown-display";

import { useTheme } from "@/theme/useTheme";

const monospace = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/**
 * Themed markdown renderer for chat messages (matches the web RichText
 * rendering: GFM-ish bold/italic/code/lists/links/headings).
 */
export function MessageMarkdown({ content, own }: { content: string; own?: boolean }) {
  const t = useTheme();
  const color = own ? t.primaryForeground : t.foreground;

  const rules = {
    body: { color },
    strong: { color, fontWeight: "700" as const },
    em: { color, fontStyle: "italic" as const },
    s: { color, textDecorationLine: "line-through" as const },
    link: { color: own ? t.accent300 : t.primary, textDecorationLine: "underline" as const },
    heading1: { color, fontSize: 19, fontWeight: "700" as const, marginTop: 8, marginBottom: 2 },
    heading2: { color, fontSize: 17, fontWeight: "700" as const, marginTop: 8, marginBottom: 2 },
    heading3: { color, fontSize: 15, fontWeight: "700" as const, marginTop: 6, marginBottom: 2 },
    heading4: { color, fontSize: 14, fontWeight: "700" as const, marginTop: 6, marginBottom: 2 },
    heading5: { color, fontSize: 14, fontWeight: "600" as const, marginTop: 4, marginBottom: 2 },
    heading6: { color, fontSize: 13, fontWeight: "600" as const, marginTop: 4, marginBottom: 2 },
    paragraph: { color, marginTop: 0, marginBottom: 4 },
    code_inline: {
      color: own ? t.primaryForeground : t.accent700,
      backgroundColor: own ? "rgba(255,255,255,0.18)" : t.muted,
      fontFamily: monospace,
      fontSize: 13,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 5,
    },
    fence: {
      backgroundColor: own ? "rgba(255,255,255,0.12)" : t.muted,
      borderColor: t.border,
      borderRadius: 10,
      padding: 8,
      marginBottom: 6,
    },
    blockquote: {
      backgroundColor: own ? "rgba(255,255,255,0.08)" : t.muted,
      borderLeftColor: own ? t.accent300 : t.accent500,
      borderLeftWidth: 3,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginBottom: 6,
    },
    bullet_list_icon: { color, marginLeft: 2, marginRight: 6 },
    ordered_list_icon: { color, marginLeft: 2, marginRight: 6 },
    hr: { backgroundColor: t.border, marginVertical: 8 },
  };

  return <Markdown style={rules as any}>{content}</Markdown>;
}

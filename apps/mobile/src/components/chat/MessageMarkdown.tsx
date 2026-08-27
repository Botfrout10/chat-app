import { Platform } from "react-native";
import { Text, View } from "react-native";
import Markdown from "react-native-markdown-display";

import { useTheme } from "@/theme/useTheme";

const monospace = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

// mirror web RichText: split content into plain segments and @mentions
const SPLIT = /(@[\p{L}\p{N}_.-]+)/gu;

/**
 * Themed markdown renderer for chat messages (matches the web RichText
 * rendering: GFM-ish bold/italic/code/lists/links/headings) with @mention
 * chip highlighting — me vs known member vs unknown — like the web.
 */
export function MessageMarkdown({
  content,
  own,
  memberTokens,
  meName,
}: {
  content: string;
  own?: boolean;
  memberTokens?: Set<string>;
  meName?: string;
}) {
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

  function chipStyle(token: string) {
    const name = token.slice(1).toLowerCase();
    const isMe = !!meName && name === meName.toLowerCase();
    const isKnown = !!memberTokens && memberTokens.has(name);
    if (own) {
      return isMe
        ? { color: t.primaryForeground, backgroundColor: t.primary }
        : isKnown
          ? { color: t.primaryForeground, backgroundColor: "rgba(255,255,255,0.25)" }
          : { color: "rgba(255,255,255,0.85)", backgroundColor: "rgba(255,255,255,0.10)" };
    }
    return isMe
      ? { color: t.primaryForeground, backgroundColor: t.primary }
      : isKnown
        ? { color: t.accent700, backgroundColor: t.accent100 }
        : { color: t.mutedForeground, backgroundColor: t.muted };
  }

  const parts = content.split(SPLIT);
  return (
    <View>
      {parts.map((part, i) => {
        if (part.startsWith("@") && part.length > 1 && SPLIT.test(part)) {
          SPLIT.lastIndex = 0;
          return (
            <Text
              key={i}
              style={[{ borderRadius: 5, paddingHorizontal: 3, fontSize: 15, fontWeight: "600" }, chipStyle(part)]}
            >
              {part}
            </Text>
          );
        }
        if (!part) return null;
        return (
          <Markdown key={i} style={rules as any}>
            {part}
          </Markdown>
        );
      })}
    </View>
  );
}

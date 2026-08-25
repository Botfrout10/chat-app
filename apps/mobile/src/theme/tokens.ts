/**
 * Petrol & Mint palette — ported from apps/web/src/app/globals.css :root.
 * Keep in sync with the web tokens (see DESIGN.md).
 */

export const light = {
  background: "#f6f8f8",
  foreground: "#0c1a19",
  card: "#ffffff",
  cardForeground: "#0c1a19",
  muted: "#edf2f2",
  mutedForeground: "#5b6f6d",
  border: "#dde6e5",
  input: "#ffffff",
  inputBorder: "#cddad9",
  primary: "#0f766e",
  primaryHover: "#115e59",
  primaryForeground: "#f0fdfa",
  secondary: "#0c1a19",
  secondaryForeground: "#f6f8f8",
  accent: "#06b6d4",
  accentForeground: "#08252b",
  destructive: "#be123c",
  destructiveForeground: "#fff1f2",
  sidebar: "#081413",
  sidebarForeground: "#e6f2ef",
  sidebarMuted: "#0f201e",
  sidebarBorder: "#16302d",
  success: "#10b981",
  warning: "#d97706",
  accent50: "#effcfa",
  accent100: "#d3f5ee",
  accent300: "#5eead4",
  accent500: "#14b8a6",
  accent600: "#0f766e",
  accent700: "#115e59",
} as const;

export type Palette = Record<keyof typeof light, string>;

export const dark: Palette = {
  background: "#07100f",
  foreground: "#e6f2ef",
  card: "#0d1a18",
  cardForeground: "#e6f2ef",
  muted: "#11201e",
  mutedForeground: "#93aaa6",
  border: "#1c2f2c",
  input: "#0d1a18",
  inputBorder: "#24403c",
  primary: "#2dd4bf",
  primaryHover: "#5eead4",
  primaryForeground: "#04201c",
  secondary: "#e6f2ef",
  secondaryForeground: "#07100f",
  accent: "#22d3ee",
  accentForeground: "#04201c",
  destructive: "#fb7185",
  destructiveForeground: "#fff1f2",
  sidebar: "#050d0c",
  sidebarForeground: "#e6f2ef",
  sidebarMuted: "#0a1716",
  sidebarBorder: "#142623",
  success: "#34d399",
  warning: "#f59e0b",
  accent50: "#04201c",
  accent100: "#0a3b33",
  accent300: "#5eead4",
  accent500: "#2dd4bf",
  accent600: "#14b8a6",
  accent700: "#0f766e",
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 24,
  full: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

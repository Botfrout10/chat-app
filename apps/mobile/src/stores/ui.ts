import { create } from "zustand";

import { themeStorage } from "@/lib/themeStorage";

export type UiDialog = "createWorkspace" | "createChannel" | "inviteMember" | "newDm" | "llmManager";

export type ThemeMode = "system" | "light" | "dark";

type State = {
  paletteOpen: boolean;
  dialog: UiDialog | null;
  theme: ThemeMode;
  setPaletteOpen: (open: boolean) => void;
  openDialog: (d: UiDialog) => void;
  closeDialog: () => void;
  setTheme: (mode: ThemeMode) => void;
  reset: () => void;
};

export const useUiStore = create<State>((set) => ({
  paletteOpen: false,
  dialog: null,
  theme: "system",
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setTheme: (theme) => {
    void themeStorage.set(theme);
    set({ theme });
  },
  reset: () => set({ paletteOpen: false, dialog: null }),
}));

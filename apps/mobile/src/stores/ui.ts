import { create } from "zustand";

export type UiDialog = "createWorkspace" | "createChannel" | "inviteMember" | "newDm" | "llmManager";

type State = {
  paletteOpen: boolean;
  dialog: UiDialog | null;
  setPaletteOpen: (open: boolean) => void;
  openDialog: (d: UiDialog) => void;
  closeDialog: () => void;
  reset: () => void;
};

export const useUiStore = create<State>((set) => ({
  paletteOpen: false,
  dialog: null,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  reset: () => set({ paletteOpen: false, dialog: null }),
}));

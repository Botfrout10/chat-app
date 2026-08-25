"use client";
import { create } from "zustand";

export type UiDialog = "createWorkspace" | "createChannel" | "inviteMember" | "newDm" | "llmManager";

type State = {
  /** which creation/management dialog is open (null = none) */
  dialog: UiDialog | null;
  /** command palette open */
  paletteOpen: boolean;
  openDialog: (d: UiDialog) => void;
  closeDialog: () => void;
  setPaletteOpen: (open: boolean) => void;
};

export const useUiStore = create<State>((set) => ({
  dialog: null,
  paletteOpen: false,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));

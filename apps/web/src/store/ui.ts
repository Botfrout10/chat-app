"use client";
import { create } from "zustand";

export type UiDialog = "createWorkspace" | "createChannel" | "inviteMember" | "newDm" | "llmManager";
export type SidebarSection = "channels" | "dms" | "ai";

function loadBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function persist(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {}
}

type State = {
  /** which creation/management dialog is open (null = none) */
  dialog: UiDialog | null;
  /** command palette open */
  paletteOpen: boolean;
  /** sidebar collapsed to an icon rail */
  sidebarCollapsed: boolean;
  /** per-section collapse inside the sidebar */
  sidebarSections: Record<SidebarSection, boolean>; // true = collapsed
  openDialog: (d: UiDialog) => void;
  closeDialog: () => void;
  setPaletteOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleSection: (s: SidebarSection) => void;
};

export const useUiStore = create<State>((set, get) => ({
  dialog: null,
  paletteOpen: false,
  sidebarCollapsed: loadBool("pulse.sidebar.collapsed", false),
  sidebarSections: {
    channels: loadBool("pulse.sidebar.sec.channels", false),
    dms: loadBool("pulse.sidebar.sec.dms", false),
    ai: loadBool("pulse.sidebar.sec.ai", false),
  },
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed;
    persist("pulse.sidebar.collapsed", sidebarCollapsed);
    set({ sidebarCollapsed });
  },
  toggleSection: (s) => {
    const sidebarSections = { ...get().sidebarSections, [s]: !get().sidebarSections[s] };
    persist(`pulse.sidebar.sec.${s}`, sidebarSections[s]);
    set({ sidebarSections });
  },
}));

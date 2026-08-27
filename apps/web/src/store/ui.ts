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
  /** sidebar completely hidden — main area takes the full width */
  sidebarHidden: boolean;
  /** per-section collapse inside the sidebar */
  sidebarSections: Record<SidebarSection, boolean>; // true = collapsed
  /** open thread parent message id (null = thread panel closed) */
  threadId: string | null;
  openDialog: (d: UiDialog) => void;
  closeDialog: () => void;
  setPaletteOpen: (open: boolean) => void;
  openThread: (id: string) => void;
  closeThread: () => void;
  /** toggle the sidebar between expanded and hidden (Ctrl/Cmd+B) */
  toggleSidebar: () => void;
  /** show the sidebar (leave hidden state) */
  showSidebar: () => void;
  /** hide the sidebar */
  hideSidebar: () => void;
  toggleSection: (s: SidebarSection) => void;
};

export const useUiStore = create<State>((set, get) => ({
  dialog: null,
  paletteOpen: false,
  sidebarHidden: loadBool("pulse.sidebar.hidden", false),
  threadId: null,
  sidebarSections: {
    channels: loadBool("pulse.sidebar.sec.channels", false),
    dms: loadBool("pulse.sidebar.sec.dms", false),
    ai: loadBool("pulse.sidebar.sec.ai", false),
  },
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openThread: (id) => set({ threadId: id }),
  closeThread: () => set({ threadId: null }),
  toggleSidebar: () => {
    const hidden = !get().sidebarHidden;
    persist("pulse.sidebar.hidden", hidden);
    set({ sidebarHidden: hidden });
  },
  showSidebar: () => {
    persist("pulse.sidebar.hidden", false);
    set({ sidebarHidden: false });
  },
  hideSidebar: () => {
    persist("pulse.sidebar.hidden", true);
    set({ sidebarHidden: true });
  },
  toggleSection: (s) => {
    const sidebarSections = { ...get().sidebarSections, [s]: !get().sidebarSections[s] };
    persist(`pulse.sidebar.sec.${s}`, sidebarSections[s]);
    set({ sidebarSections });
  },
}));

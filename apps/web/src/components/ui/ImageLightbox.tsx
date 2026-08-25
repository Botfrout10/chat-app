"use client";
import { useEffect } from "react";
import { create } from "zustand";

type State = {
  url: string | null;
  alt: string;
  open: (url: string, alt: string) => void;
  close: () => void;
};

export const useLightbox = create<State>((set) => ({
  url: null,
  alt: "",
  open: (url, alt) => set({ url, alt }),
  close: () => set({ url: null, alt: "" }),
}));

export function ImageLightbox() {
  const { url, alt, close } = useLightbox();

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [url, close]);

  if (!url) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={close}
    >
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-sm text-white/80 truncate max-w-[60vw]">{alt}</span>
        <div className="flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-white/60 hover:text-white underline underline-offset-2"
          >
            Open in new tab
          </a>
          <button
            onClick={close}
            aria-label="Close preview"
            className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/15 text-white flex items-center justify-center text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 min-h-0" onClick={close}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain rounded-xl shadow-2xl bg-black"
        />
      </div>
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import type { OutlineItem } from "@/lib/article-outline";

export type ReaderFont = "sans" | "serif";
export type ReaderSize = "sm" | "md" | "lg";

const PREFS_KEY = "dawnkb:reader-prefs";
const SERVER_PREFS: { font: ReaderFont; size: ReaderSize } = {
  font: "serif",
  size: "md",
};
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedPrefs = SERVER_PREFS;

function parsePrefs(raw: string | null) {
  try {
    const saved = JSON.parse(raw || "null") as {
      font?: ReaderFont;
      size?: ReaderSize;
    } | null;
    const font: ReaderFont = saved?.font === "sans" ? "sans" : "serif";
    const size: ReaderSize =
      saved?.size === "sm" || saved?.size === "lg" ? saved.size : "md";
    return { font, size };
  } catch {
    return SERVER_PREFS;
  }
}

function readPrefs() {
  const raw = localStorage.getItem(PREFS_KEY);
  if (raw === cachedRaw) return cachedPrefs;
  cachedRaw = raw;
  cachedPrefs = parsePrefs(raw);
  return cachedPrefs;
}

function writePrefs(next: { font: ReaderFont; size: ReaderSize }) {
  const raw = JSON.stringify(next);
  localStorage.setItem(PREFS_KEY, raw);
  cachedRaw = raw;
  cachedPrefs = next;
  for (const listener of listeners) listener();
}

function subscribePrefs(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function serverPrefs() {
  return SERVER_PREFS;
}

export function ArticleOutline({
  items,
  activeId,
  onJump,
}: {
  items: OutlineItem[];
  activeId: string;
  onJump: (id: string) => void;
}) {
  return (
    <nav className="reader-outline" aria-label="本篇目录">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          data-level={item.level}
          aria-current={activeId === item.id ? "location" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onJump(item.id);
          }}
        >
          {item.text}
        </a>
      ))}
    </nav>
  );
}

export function ReaderTuner({
  font,
  size,
  onFont,
  onSize,
}: {
  font: ReaderFont;
  size: ReaderSize;
  onFont: (font: ReaderFont) => void;
  onSize: (size: ReaderSize) => void;
}) {
  return (
    <div className="reader-tuner">
      <div className="reader-tuner-track" role="group" aria-label="阅读字体">
        <button
          type="button"
          aria-pressed={font === "sans"}
          onClick={() => onFont("sans")}
        >
          非衬线
        </button>
        <button
          type="button"
          aria-pressed={font === "serif"}
          onClick={() => onFont("serif")}
        >
          衬线
        </button>
      </div>
      <div className="reader-tuner-track" role="group" aria-label="正文字号">
        <button
          type="button"
          aria-pressed={size === "sm"}
          aria-label="小字号"
          onClick={() => onSize("sm")}
        >
          A-
        </button>
        <button
          type="button"
          aria-pressed={size === "md"}
          aria-label="标准字号"
          onClick={() => onSize("md")}
        >
          标准
        </button>
        <button
          type="button"
          aria-pressed={size === "lg"}
          aria-label="大字号"
          onClick={() => onSize("lg")}
        >
          A+
        </button>
      </div>
    </div>
  );
}

export function useReaderPrefs() {
  const prefs = useSyncExternalStore(subscribePrefs, readPrefs, serverPrefs);
  return {
    font: prefs.font,
    size: prefs.size,
    setFont: (font: ReaderFont) => writePrefs({ font, size: prefs.size }),
    setSize: (size: ReaderSize) => writePrefs({ font: prefs.font, size }),
  };
}

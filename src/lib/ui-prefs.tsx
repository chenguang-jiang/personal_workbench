"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { makeT, type Locale, type TFunc } from "@/lib/i18n";

export const ACCENTS = [
  { id: "violet", swatch: "#6d4bd2" },
  { id: "blue", swatch: "#4655c4" },
  { id: "teal", swatch: "#3f8d84" },
  { id: "orange", swatch: "#c2622a" },
  { id: "crimson", swatch: "#bb4450" },
  { id: "magenta", swatch: "#bb3f8f" },
  { id: "amber", swatch: "#b8862b" },
] as const;

export type ThemeMode = "light" | "dark";

interface UiPrefsValue {
  locale: Locale;
  accent: string;
  theme: ThemeMode;
  setLocale: (locale: Locale) => void;
  setAccent: (accent: string) => void;
  setTheme: (theme: ThemeMode) => void;
  t: TFunc;
}

const UiPrefsContext = createContext<UiPrefsValue | null>(null);

export interface UiPrefsInitial {
  locale?: Locale;
  accent?: string;
  theme?: ThemeMode;
}

export function UiPrefsProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: UiPrefsInitial;
}) {
  // 初始值来自服务端（cookie），SSR 与客户端首帧同源，避免 hydration 不一致
  const [locale, setLocale] = useState<Locale>(initial?.locale ?? "zh");
  const [accent, setAccent] = useState<string>(initial?.accent ?? "violet");
  const [theme, setTheme] = useState<ThemeMode>(initial?.theme ?? "light");

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale === "en" ? "en" : "zh-CN";
    root.dataset.accent = accent;
    root.dataset.theme = theme;
    const cookie = (key: string, value: string) =>
      (document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`);
    cookie("dawnkb-locale", locale);
    cookie("dawnkb-accent", accent);
    cookie("dawnkb-theme", theme);
    try {
      window.localStorage.setItem("dawnkb-locale", locale);
      window.localStorage.setItem("dawnkb-accent", accent);
      window.localStorage.setItem("dawnkb-theme", theme);
    } catch {
      /* 私密模式下忽略 */
    }
  }, [locale, accent, theme]);

  const value = useMemo<UiPrefsValue>(
    () => ({
      locale,
      accent,
      theme,
      setLocale,
      setAccent,
      setTheme,
      t: makeT(locale),
    }),
    [locale, accent, theme],
  );

  return (
    <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>
  );
}

export function useUiPrefs(): UiPrefsValue {
  const ctx = useContext(UiPrefsContext);
  if (!ctx) throw new Error("useUiPrefs 必须在 UiPrefsProvider 内使用");
  return ctx;
}

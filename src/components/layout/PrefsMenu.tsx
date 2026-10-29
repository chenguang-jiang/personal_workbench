"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Languages, Moon, Sun } from "lucide-react";
import { ACCENTS, useUiPrefs } from "@/lib/ui-prefs";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function PrefsMenu() {
  const { locale, setLocale, accent, setAccent, theme, setTheme, t } = useUiPrefs();
  const [open, setOpen] = useState<null | "lang" | "theme">(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const currentAccent = ACCENTS.find((item) => item.id === accent) ?? ACCENTS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="prefs-row" ref={rootRef}>
      {/* 语言切换按钮 */}
      <div className="prefs-item">
        <button
          type="button"
          className={cn("prefs-button", open === "lang" && "prefs-button--open")}
          onClick={() => setOpen(open === "lang" ? null : "lang")}
          aria-label={t("prefs_language")}
          aria-expanded={open === "lang"}
          title={locale === "zh" ? "语言：中文" : "Language: English"}
        >
          <Languages className="prefs-btn-icon" aria-hidden="true" />
          <span className="prefs-btn-label">{locale === "zh" ? "中文" : "EN"}</span>
          <ChevronDown className="prefs-btn-trailing prefs-btn-chevron" aria-hidden="true" />
        </button>
        {open === "lang" && (
          <div className="prefs-pop prefs-pop--lang" role="menu">
            {(["zh", "en"] as Locale[]).map((item) => (
              <button
                key={item}
                type="button"
                role="menuitem"
                className={
                  locale === item ? "prefs-option prefs-option--active" : "prefs-option"
                }
                onClick={() => {
                  setLocale(item);
                  setOpen(null);
                }}
              >
                <span>{item === "zh" ? "中文" : "English"}</span>
                {locale === item && <Check className="prefs-option-check" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 外观与主题色切换按钮 */}
      <div className="prefs-item">
        <button
          type="button"
          className={cn("prefs-button", open === "theme" && "prefs-button--open")}
          onClick={() => setOpen(open === "theme" ? null : "theme")}
          aria-label={t("prefs_appearance")}
          aria-expanded={open === "theme"}
          title={theme === "dark" ? "外观：深色模式" : "外观：浅色模式"}
        >
          {theme === "dark" ? (
            <Moon className="prefs-btn-icon" aria-hidden="true" />
          ) : (
            <Sun className="prefs-btn-icon" aria-hidden="true" />
          )}
          <span className="prefs-btn-label">
            {theme === "dark" ? (locale === "zh" ? "暗色" : "Dark") : (locale === "zh" ? "浅色" : "Light")}
          </span>
          <span
            className="prefs-btn-trailing prefs-accent-dot"
            style={{ backgroundColor: currentAccent.swatch }}
            aria-hidden="true"
          />
        </button>
        {open === "theme" && (
          <div className="prefs-pop prefs-pop--theme" role="menu">
            <div className="prefs-theme-header">
              <span className="prefs-pop-title">
                {locale === "zh" ? "强调色" : "Accent"}
              </span>
              <button
                type="button"
                role="menuitem"
                className="prefs-mode-toggle"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={theme === "dark" ? t("prefs_light") : t("prefs_dark")}
                title={theme === "dark" ? "切换为浅色" : "切换为深色"}
              >
                {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
                <span>{theme === "dark" ? (locale === "zh" ? "浅色" : "Light") : (locale === "zh" ? "暗色" : "Dark")}</span>
              </button>
            </div>
            <div className="prefs-swatches-grid">
              {ACCENTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  aria-label={`accent-${item.id}`}
                  className={
                    accent === item.id ? "prefs-swatch prefs-swatch--active" : "prefs-swatch"
                  }
                  style={{ background: item.swatch }}
                  onClick={() => setAccent(item.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

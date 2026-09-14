"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Languages, Moon, Palette, Sun } from "lucide-react";
import { ACCENTS, useUiPrefs } from "@/lib/ui-prefs";
import type { Locale } from "@/lib/i18n";

export function PrefsMenu() {
  const { locale, setLocale, accent, setAccent, theme, setTheme, t } = useUiPrefs();
  const [open, setOpen] = useState<null | "lang" | "theme">(null);
  const rootRef = useRef<HTMLDivElement>(null);

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
      <div className="prefs-item">
        <button
          type="button"
          className="prefs-button"
          onClick={() => setOpen(open === "lang" ? null : "lang")}
          aria-label={t("prefs_language")}
          aria-expanded={open === "lang"}
        >
          <Languages aria-hidden="true" />
          <span>{locale === "zh" ? "中文" : "EN"}</span>
          <ChevronDown aria-hidden="true" />
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
                {item === "zh" ? "中文" : "English"}
                {locale === item && <Check aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="prefs-item">
        <button
          type="button"
          className="prefs-button"
          onClick={() => setOpen(open === "theme" ? null : "theme")}
          aria-label={t("prefs_appearance")}
          aria-expanded={open === "theme"}
        >
          <Palette aria-hidden="true" />
          <span className="prefs-accent-dot" aria-hidden="true" />
          {theme === "dark" && <Moon aria-hidden="true" className="prefs-moon" />}
        </button>
        {open === "theme" && (
          <div className="prefs-pop prefs-pop--theme" role="menu">
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
            <span className="prefs-pop-divider" aria-hidden="true" />
            <button
              type="button"
              role="menuitem"
              className="prefs-swatch prefs-swatch--mode"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? t("prefs_light") : t("prefs_dark")}
              title={theme === "dark" ? t("prefs_light") : t("prefs_dark")}
            >
              {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Bot,
  BrainCircuit,
  Command,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  Menu,
  MessagesSquare,
  Network,
  Newspaper,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  X,
} from "lucide-react";
import { DawnLogo } from "@/components/brand/DawnLogo";
import { PrefsMenu } from "@/components/layout/PrefsMenu";
import { cn } from "@/lib/utils";
import { useUiPrefs } from "@/lib/ui-prefs";
import type { MessageKey } from "@/lib/i18n";
import type { SearchHit } from "@/lib/search";

const NAV_ITEMS: {
  icon: typeof LayoutDashboard;
  labelKey: MessageKey;
  hintKey: MessageKey;
  href: string;
}[] = [
  {
    icon: LayoutDashboard,
    labelKey: "nav_overview",
    hintKey: "nav_overview_hint",
    href: "/dashboard",
  },
  {
    icon: Network,
    labelKey: "nav_graph",
    hintKey: "nav_graph_hint",
    href: "/dashboard/knowledge",
  },
  {
    icon: Library,
    labelKey: "nav_library",
    hintKey: "nav_library_hint",
    href: "/dashboard/library",
  },
  {
    icon: BookOpen,
    labelKey: "nav_reading",
    hintKey: "nav_reading_hint",
    href: "/reading",
  },
  {
    icon: NotebookPen,
    labelKey: "nav_notes",
    hintKey: "nav_notes_hint",
    href: "/notes",
  },
  {
    icon: GraduationCap,
    labelKey: "nav_quiz",
    hintKey: "nav_quiz_hint",
    href: "/quiz",
  },
  {
    icon: Newspaper,
    labelKey: "nav_daily",
    hintKey: "nav_daily_hint",
    href: "/daily",
  },
  {
    icon: BrainCircuit,
    labelKey: "nav_brainstorm",
    hintKey: "nav_brainstorm_hint",
    href: "/brainstorm",
  },
  {
    icon: Bot,
    labelKey: "nav_dawn_agent",
    hintKey: "nav_dawn_agent_hint",
    href: "/dawn-agent",
  },
  {
    icon: MessagesSquare,
    labelKey: "nav_dawn_harness",
    hintKey: "nav_dawn_harness_hint",
    href: "/dawn-harness",
  },
];

/** 在标题中高亮查询词命中片段 */
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return <>{text}</>;
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    let index = lower.indexOf(token);
    while (index >= 0) {
      ranges.push([index, index + token.length]);
      index = lower.indexOf(token, index + 1);
    }
  }
  if (ranges.length === 0) return <>{text}</>;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={i}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useUiPrefs();
  // 阅读详情页进入沉浸模式：隐藏全局导航，避免与同文件夹抽屉形成双侧栏
  const inReaderDetail = /^\/reading\/[^/]+/.test(pathname ?? "");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [vaultState, setVaultState] = useState<
    "loading" | "ready" | "syncing" | "error" | "disabled"
  >("loading");
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((current) => !current);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMobileOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    void fetch("/api/obsidian/sync", { cache: "no-store" })
      .then((response) => response.json())
      .then((status) => {
        if (!status.configured) setVaultState("disabled");
        else if (status.state === "syncing" || status.state === "starting")
          setVaultState("syncing");
        else if (status.state === "ready") setVaultState("ready");
        else setVaultState("error");
      })
      .catch(() => setVaultState("error"));
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 打开面板即拉取（空查询返回最近更新），输入防抖 140ms 加权搜索
  useEffect(() => {
    if (!searchOpen) return;
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}&limit=12`, {
        cache: "no-store",
      })
        .then((response) => response.json())
        .then((data: { hits: SearchHit[] }) => setHits(data.hits ?? []))
        .catch(() => {});
    }, 140);
    return () => clearTimeout(timer);
  }, [query, searchOpen]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) =>
      `${t(item.labelKey)} ${t(item.hintKey)}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, t]);

  const combined = useMemo(
    () => [
      ...filteredItems.map((item) => ({
        kind: "page" as const,
        href: item.href,
        item,
      })),
      ...hits.map((hit) => ({
        kind: "article" as const,
        href: `/reading/${hit.id}`,
        hit,
      })),
    ],
    [filteredItems, hits],
  );

  function closePalette() {
    setSearchOpen(false);
    setQuery("");
  }

  function goTo(href: string) {
    closePalette();
    router.push(href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (combined.length === 0) return;
      setActiveIndex((current) => {
        const next =
          event.key === "ArrowDown"
            ? (current + 1) % combined.length
            : (current - 1 + combined.length) % combined.length;
        return next;
      });
    }
    if (event.key === "Enter") {
      const target = combined[Math.min(activeIndex, combined.length - 1)];
      if (target) goTo(target.href);
    }
  }

  useEffect(() => {
    const el = resultsRef.current?.querySelector<HTMLElement>(
      ".command-result--active",
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <>
      <header className="mobile-bar">
        <button
          type="button"
          className="icon-button"
          onClick={() => setMobileOpen(true)}
          aria-label={t("open_nav")}
        >
          <Menu aria-hidden="true" />
        </button>
        <Link
          href="/dashboard"
          className="mobile-brand"
          aria-label={t("brand_home")}
        >
          <span className="brand-mark">
            <DawnLogo />
          </span>
          <span>晨光知识库</span>
        </Link>
        <button
          type="button"
          className="icon-button"
          onClick={() => setSearchOpen(true)}
          aria-label={t("search_workbench")}
        >
          <Search aria-hidden="true" />
        </button>
      </header>

      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label={t("close_nav")}
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "sidebar",
          collapsed && "sidebar--collapsed",
          mobileOpen && "sidebar--mobile-open",
          inReaderDetail && "sidebar--hidden",
        )}
      >
        <div className="sidebar-brand-row">
          <Link
            href="/dashboard"
            className="sidebar-brand"
            aria-label={t("brand_home")}
          >
            <span className="brand-mark">
              <DawnLogo />
            </span>
            <span className="brand-copy" aria-hidden="true">
              <span className="brand-copy__word brand-copy__word--name">
                DawnKB
              </span>
              <span className="brand-copy__word brand-copy__word--title">
                晨光知识库
              </span>
            </span>
          </Link>
          <button
            type="button"
            className="sidebar-collapse desktop-only"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? t("expand_sidebar") : t("collapse_sidebar")}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="sidebar-collapse mobile-only"
            onClick={() => setMobileOpen(false)}
            aria-label={t("close_nav")}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="主要导航">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" &&
                pathname.startsWith(item.href.split("#")[0]));

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? t(item.labelKey) : undefined}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "sidebar-link",
                  isActive && "sidebar-link--active",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <item.icon aria-hidden="true" />
                <span className="sidebar-link-copy">
                  <span>{t(item.labelKey)}</span>
                  <small>{t(item.hintKey)}</small>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="command-button"
            onClick={() => setSearchOpen(true)}
          >
            <Search aria-hidden="true" />
            <span>{t("search_button")}</span>
            <kbd>⌘ K</kbd>
          </button>
          <PrefsMenu />
          <Link
            href="/settings"
            className={cn(
              "sidebar-link",
              pathname === "/settings" && "sidebar-link--active",
            )}
            onClick={() => setMobileOpen(false)}
          >
            <Settings aria-hidden="true" />
            <span className="sidebar-link-copy">
              <span>{t("nav_settings")}</span>
              <small>{t("nav_settings_hint")}</small>
            </span>
          </Link>
          <div
            className={`sync-state sync-state--${vaultState}`}
            title={
              vaultState === "ready"
                ? "Obsidian 保存后约半秒自动更新"
                : "可在设置中检查同步状态"
            }
          >
            <span className={`status-dot status-dot--${vaultState}`} />
            <span>
              {vaultState === "ready"
                ? t("sync_ready")
                : vaultState === "syncing" || vaultState === "loading"
                  ? t("sync_syncing")
                  : vaultState === "disabled"
                    ? t("sync_disabled")
                    : t("sync_error")}
            </span>
          </div>
        </div>
      </aside>

      {searchOpen && (
        <div
          className="command-layer"
          role="presentation"
          onMouseDown={() => closePalette()}
        >
          <section
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("search_workbench")}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="command-input-row">
              <Command aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder={t("command_placeholder")}
                aria-label={t("command_placeholder")}
              />
              <kbd>ESC</kbd>
            </div>
            <div className="command-results" ref={resultsRef}>
              {filteredItems.length > 0 && (
                <>
                  <p>{t("command_quick")}</p>
                  {filteredItems.map((item, index) => {
                    return (
                      <button
                        type="button"
                        key={item.href}
                        onClick={() => goTo(item.href)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          "command-result",
                          index === activeIndex && "command-result--active",
                        )}
                      >
                        <item.icon aria-hidden="true" />
                        <span>
                          <strong>{t(item.labelKey)}</strong>
                          <small>{t(item.hintKey)}</small>
                        </span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    );
                  })}
                </>
              )}
              <p>
                {query.trim()
                  ? `${t("command_articles")} · ${hits.length}`
                  : t("command_recent")}
              </p>
              {hits.map((hit, hitIndex) => {
                const index = filteredItems.length + hitIndex;
                return (
                  <button
                    type="button"
                    key={hit.id}
                    onClick={() => goTo(`/reading/${hit.id}`)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "command-result",
                      index === activeIndex && "command-result--active",
                    )}
                  >
                    <FileText aria-hidden="true" />
                    <span className="command-result-copy">
                      <strong>
                        <Highlight text={hit.title} query={query} />
                      </strong>
                      <small className="command-result-meta">
                        {hit.folder && (
                          <span className="command-folder">{hit.folder}</span>
                        )}
                        {hit.tags.slice(0, 3).map((tag) => (
                          <span className="command-tag" key={tag}>
                            #{tag}
                          </span>
                        ))}
                        {query.trim() &&
                          hit.matched.map((field) => (
                            <span className="command-match" key={field}>
                              {t(`match_${field}` as MessageKey)}
                            </span>
                          ))}
                      </small>
                    </span>
                    {query.trim() && (
                      <span className="command-score">{hit.score}</span>
                    )}
                  </button>
                );
              })}
              {query.trim() &&
                hits.length === 0 &&
                filteredItems.length === 0 && (
                  <div className="command-empty">{t("command_no_hits")}</div>
                )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Bookmark, Check, Flame, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useUiPrefs } from "@/lib/ui-prefs";

type HotItem = {
  rank: number;
  title: string;
  url: string;
  status?: string;
  source?: string;
  time?: string;
  heat?: number;
};

type HotPayload = {
  date: string;
  fetchedAt: string;
  items: HotItem[];
  cached?: boolean;
  warning?: string;
};

const SAVED_KEY = "dawn-hot-saved";

export default function DailyHotPage() {
  const { t } = useUiPrefs();
  const [payload, setPayload] = useState<HotPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setSaved(
          JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as string[],
        );
      } catch {
        setSaved([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch(refresh ? "/api/hot?refresh=1" : "/api/hot");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "热点加载失败");
      setPayload(data as HotPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "热点加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function toggleSaved(title: string) {
    setSaved((current) => {
      const next = current.includes(title)
        ? current.filter((item) => item !== title)
        : [...current, title];
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      return next;
    });
  }

  const items = payload?.items ?? [];
  const fetchedAt = payload?.fetchedAt
    ? new Date(payload.fetchedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";

  return (
    <div className="page-frame page-frame--wide">
      <PageHeader
        eyebrow="AI HOT RADAR · TOP 10"
        title={t("daily_title")}
        description={t("daily_desc")}
        actions={
          <span className="tag">
            <span className="status-dot" /> AI HOT 已连接 · {fetchedAt}
            {payload?.cached ? " · 缓存" : ""}
          </span>
        }
      />

      <section className="digest-stats panel" aria-label="每日热点统计">
        <div>
          <strong>{items.length || 10}</strong>
          <span>热点事件</span>
        </div>
        <div>
          <strong>{items[0]?.heat ?? "--"}</strong>
          <span>TOP 1 热度</span>
        </div>
        <div>
          <strong>{saved.length}</strong>
          <span>稍后阅读</span>
        </div>
      </section>

      <div className="digest-sync-bar">
        <span>
          <Flame aria-hidden="true" /> 来源 aihot.virxact.com · 过去 48 小时最热
          AI 事件，按热度实时排序
        </span>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void load(true)}
          disabled={refreshing || loading}
        >
          <RefreshCw
            className={refreshing ? "is-spinning" : ""}
            aria-hidden="true"
          />{" "}
          {refreshing ? "抓取中" : "刷新"}
        </button>
      </div>

      {error && !items.length && (
        <div className="panel hot-error">
          <p>{error}</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void load(true)}
          >
            重试
          </button>
        </div>
      )}

      {loading && !items.length ? (
        <div className="hot-list" aria-label="热点加载中">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="hot-row hot-row--skeleton" key={index}>
              <span className="hot-rank">0{index + 1}</span>
              <div className="hot-row-body">
                <div className="skeleton-line" />
                <div className="skeleton-line skeleton-line--short" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ol className="hot-list" aria-label="AI 热点 TOP 10">
          {items.map((item) => (
            <li className="hot-row" key={`${item.rank}-${item.title}`}>
              <span
                className={
                  item.rank <= 3
                    ? `hot-rank hot-rank--top${item.rank}`
                    : "hot-rank"
                }
              >
                {String(item.rank).padStart(2, "0")}
              </span>
              <div className="hot-row-body">
                <div className="hot-row-title-line">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hot-row-title"
                  >
                    {item.title}
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                  {item.status && (
                    <span className="hot-row-status">{item.status}</span>
                  )}
                </div>
                <div className="hot-row-meta">
                  {item.source && <span>{item.source}</span>}
                  {item.source && item.time && (
                    <span aria-hidden="true">·</span>
                  )}
                  {item.time && <span>{item.time}</span>}
                </div>
              </div>
              {typeof item.heat === "number" && (
                <span className="hot-row-heat" title="热度值">
                  <Flame aria-hidden="true" />
                  {item.heat}
                </span>
              )}
              <button
                type="button"
                className={
                  saved.includes(item.title)
                    ? "icon-button saved"
                    : "icon-button"
                }
                onClick={() => toggleSaved(item.title)}
                aria-label="稍后阅读"
              >
                {saved.includes(item.title) ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Bookmark aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  FolderInput,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";

type OrganizeItem = {
  id: string;
  kind: "duplicate" | "useless" | "reclassify";
  action: "delete" | "move";
  title: string;
  vaultPath: string;
  targetPath?: string;
  reason: string;
  confidence: number;
  defaultChecked: boolean;
};

type PlanSnapshot = {
  id: string;
  status: "running" | "ready" | "error";
  progress: number;
  items: OrganizeItem[];
  stats: { scanned: number; duplicates: number; useless: number; reclassify: number; remaining: number };
  error: string | null;
};

type ApplyResult = { id: string; ok: boolean; error?: string };

const KIND_META = {
  duplicate: { label: "重复内容", icon: Copy, hint: "内容相同或高度相似的文档，各保留一份" },
  useless: { label: "疑似无用", icon: Trash2, hint: "空文档、占位页与几乎没有正文的残页" },
  reclassify: { label: "建议归类", icon: FolderInput, hint: "AI 建议移动的文档，勾选后真实移动文件" },
} as const;

const POLL_INTERVAL_MS = 1500;

/**
 * AI 一键整理对话框：发起扫描 → 轮询进度 → 分组勾选 → 应用选中项。
 * 删除的条目进 Vault 回收站（.dawnkb-trash），可随时恢复。
 */
export function OrganizeDialog({ onApplied, onClose }: { onApplied: () => void; onClose: () => void }) {
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<ApplyResult[] | null>(null);
  const [error, setError] = useState("");
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
    };
  }, []);

  // 轮询方案状态，ready/error 后停止
  const planId = plan?.id ?? null;
  const planStatus = plan?.status ?? null;
  useEffect(() => {
    if (!planId || planStatus !== "running") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/knowledge/organize/${planId}`);
        const data = (await response.json()) as PlanSnapshot & { error?: string };
        if (!response.ok) throw new Error(data.error || "读取整理进度失败");
        if (closedRef.current) return;
        setPlan(data);
        if (data.status === "ready") {
          setChecked(new Set(data.items.filter((item) => item.defaultChecked).map((item) => item.id)));
        }
      } catch (err) {
        if (!closedRef.current) setError(err instanceof Error ? err.message : "读取整理进度失败");
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [planId, planStatus]);

  // 打开对话框即发起一轮扫描；若已有任务在跑（409 带 runningPlanId），直接接上它的进度
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const response = await fetch("/api/knowledge/organize", { method: "POST" });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 409 && typeof data?.runningPlanId === "string" && data.runningPlanId) {
            if (!cancelled) setPlan({ ...(data as PlanSnapshot), id: data.runningPlanId as string });
            return;
          }
          throw new Error(data?.error || "发起整理失败");
        }
        if (!cancelled) setPlan(data as PlanSnapshot);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "发起整理失败");
      } finally {
        if (!cancelled) setStarting(false);
      }
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !applying) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applying, onClose]);

  const toggle = useCallback((id: string) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleKind = useCallback((kind: OrganizeItem["kind"], selectAll: boolean) => {
    setChecked((previous) => {
      const next = new Set(previous);
      for (const item of plan?.items ?? []) {
        if (item.kind !== kind) continue;
        if (selectAll) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }, [plan]);

  async function apply() {
    if (!plan || applying || checked.size === 0) return;
    setApplying(true);
    setError("");
    try {
      const response = await fetch(`/api/knowledge/organize/${plan.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [...checked] }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "应用整理失败");
      setApplyResults(data.results as ApplyResult[]);
      setPlan({ ...(data as PlanSnapshot) });
      setChecked(new Set());
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用整理失败");
    } finally {
      setApplying(false);
    }
  }

  const running = starting || plan?.status === "running";
  const groups = (["duplicate", "useless", "reclassify"] as const)
    .map((kind) => ({ kind, items: plan?.items.filter((item) => item.kind === kind) ?? [] }))
    .filter((group) => group.items.length > 0);

  return (
    <div
      className="confirm-overlay organize-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="AI 整理知识库"
      onClick={applying ? undefined : onClose}
    >
      <div className="organize-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="organize-head">
          <span className="confirm-dialog-icon" aria-hidden="true">
            <Sparkles />
          </span>
          <div>
            <h2>AI 整理知识库</h2>
            <p>删除的内容会进入回收站，可随时恢复；归类会真实移动文件。</p>
          </div>
          <button
            type="button"
            className="organize-close"
            aria-label="关闭"
            disabled={applying}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {error && (
          <div className="organize-banner organize-banner--error" role="alert">
            <AlertTriangle aria-hidden="true" /> {error}
          </div>
        )}

        {running ? (
          <div className="organize-progress" role="status">
            <Loader2 className="ai-spinner" aria-hidden="true" />
            <div>
              <strong>正在扫描知识库…</strong>
              <small>
                确定性扫描全库查重，再用 AI 为散落文档挑选目录，通常需要一两分钟。
                {plan ? `（${plan.progress}%）` : ""}
              </small>
              <div className="organize-progress-bar">
                <span style={{ width: `${plan?.progress ?? 0}%` }} />
              </div>
            </div>
          </div>
        ) : plan?.status === "error" ? (
          <div className="organize-banner organize-banner--error" role="alert">
            <AlertTriangle aria-hidden="true" /> {plan.error || "整理任务失败，请重试"}
          </div>
        ) : plan && plan.items.length === 0 && !applyResults ? (
          <div className="organize-empty">
            <Check aria-hidden="true" />
            <strong>知识库很整洁</strong>
            <span>本次扫描 {plan.stats.scanned} 篇文档，没有发现重复、无用或需要归类的内容。</span>
          </div>
        ) : null}

        {applyResults && (
          <div className={`organize-banner ${applyResults.some((r) => !r.ok) ? "organize-banner--warn" : "organize-banner--ok"}`}>
            <Check aria-hidden="true" />
            已应用 {applyResults.filter((r) => r.ok).length} 项
            {applyResults.some((r) => !r.ok)
              ? `，${applyResults.filter((r) => !r.ok).length} 项失败：${applyResults.find((r) => !r.ok)?.error ?? ""}`
              : ""}
          </div>
        )}

        {plan && plan.status === "ready" && groups.length > 0 && (
          <div className="organize-body">
            {plan.stats.remaining > 0 && (
              <p className="organize-remaining">
                本次 AI 分析了部分归类候选，还有 {plan.stats.remaining} 篇待分析，应用后可再点一次继续。
              </p>
            )}
            {groups.map(({ kind, items }) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              const kindChecked = items.filter((item) => checked.has(item.id)).length;
              return (
                <section className="organize-group" key={kind}>
                  <div className="organize-group-head">
                    <Icon aria-hidden="true" />
                    <div>
                      <strong>
                        {meta.label} <span className="tag">{items.length}</span>
                      </strong>
                      <small>{meta.hint}</small>
                    </div>
                    <button
                      type="button"
                      className="button button-secondary organize-group-toggle"
                      disabled={applying}
                      onClick={() => toggleKind(kind, kindChecked < items.length)}
                    >
                      {kindChecked === items.length ? "取消全选" : "全选"}
                    </button>
                  </div>
                  <ul className="organize-list">
                    {items.map((item) => (
                      <li key={item.id}>
                        <label className={checked.has(item.id) ? "checked" : ""}>
                          <input
                            type="checkbox"
                            checked={checked.has(item.id)}
                            disabled={applying}
                            onChange={() => toggle(item.id)}
                          />
                          <span className="organize-item-main">
                            <strong title={item.vaultPath}>{item.title}</strong>
                            <small className="organize-item-path">
                              {item.action === "move" ? (
                                <>
                                  {item.vaultPath} <FolderInput aria-hidden="true" /> {item.targetPath}
                                </>
                              ) : (
                                item.vaultPath
                              )}
                            </small>
                            <small className="organize-item-reason">{item.reason}</small>
                          </span>
                          <span className="organize-item-confidence">
                            {Math.round(item.confidence * 100)}%
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        <footer className="organize-foot">
          <small>
            {checked.size > 0
              ? `已勾选 ${checked.size} 项 · 删除进回收站可恢复，归类会移动真实文件`
              : "勾选要执行的条目后应用"}
          </small>
          <div className="confirm-actions">
            <button type="button" className="button button-secondary" onClick={onClose} disabled={applying}>
              {applyResults || groups.length === 0 ? "关闭" : "取消"}
            </button>
            {plan?.status === "ready" && groups.length > 0 && (
              <button
                type="button"
                className="button button-purple"
                onClick={() => void apply()}
                disabled={applying || checked.size === 0}
              >
                {applying ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}
                {applying ? "应用中…" : `应用选中 (${checked.size})`}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

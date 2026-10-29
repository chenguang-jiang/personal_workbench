"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";

type TrashEntry = {
  trashPath: string;
  originalPath: string;
  name: string;
  deletedAt: string;
  kind: "folder" | "file";
};

/** 回收站抽屉：列出 .dawnkb-trash 里的条目，支持恢复单条与清空 */
export function TrashDrawer({ onRestored, onClose }: { onRestored: () => void; onClose: () => void }) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/knowledge/trash");
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "读取回收站失败");
        if (!cancelled) setEntries(data.entries as TrashEntry[]);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "读取回收站失败");
        setEntries([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyPath && !emptying) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busyPath, emptying, onClose]);

  async function restore(trashPath: string) {
    if (busyPath) return;
    setBusyPath(trashPath);
    setError("");
    try {
      const response = await fetch("/api/knowledge/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashPath }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "恢复失败");
      setEntries((previous) => (previous ?? []).filter((entry) => entry.trashPath !== trashPath));
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setBusyPath(null);
    }
  }

  async function emptyAll() {
    if (emptying) return;
    setEmptying(true);
    setError("");
    try {
      const response = await fetch("/api/knowledge/trash", { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "清空回收站失败");
      setEntries([]);
      setConfirmEmpty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空回收站失败");
    } finally {
      setEmptying(false);
    }
  }

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="回收站" onClick={busyPath || emptying ? undefined : onClose}>
      <div className="trash-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="organize-head">
          <span className="confirm-dialog-icon" aria-hidden="true">
            <Trash2 />
          </span>
          <div>
            <h2>回收站</h2>
            <p>整理时删除的文档暂存在这里，恢复后会重新入库。</p>
          </div>
          <button type="button" className="organize-close" aria-label="关闭" onClick={onClose} disabled={Boolean(busyPath) || emptying}>
            ×
          </button>
        </header>

        {error && (
          <div className="organize-banner organize-banner--error" role="alert">
            <AlertTriangle aria-hidden="true" /> {error}
          </div>
        )}

        <div className="trash-body">
          {entries === null ? (
            <div className="organize-progress" role="status">
              <Loader2 className="ai-spinner" aria-hidden="true" />
              <div>
                <strong>正在读取回收站…</strong>
              </div>
            </div>
          ) : entries.length === 0 ? (
            <div className="organize-empty">
              <Trash2 aria-hidden="true" />
              <strong>回收站是空的</strong>
              <span>被整理删除的文档会出现在这里。</span>
            </div>
          ) : (
            <ul className="trash-list">
              {entries.map((entry) => (
                <li key={entry.trashPath}>
                  <span className="organize-item-main">
                    <strong title={entry.originalPath}>
                      {entry.kind === "folder" ? entry.name : entry.name.replace(/\.md$/i, "")}
                      {entry.kind === "folder" && <em className="folder-empty-tag">文件夹</em>}
                    </strong>
                    <small className="organize-item-path">原位置 {entry.originalPath}</small>
                    <small className="organize-item-reason">删除于 {new Date(entry.deletedAt).toLocaleString("zh-CN")}</small>
                  </span>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={Boolean(busyPath)}
                    onClick={() => void restore(entry.trashPath)}
                  >
                    {busyPath === entry.trashPath ? (
                      <Loader2 className="ai-spinner" aria-hidden="true" />
                    ) : (
                      <RotateCcw aria-hidden="true" />
                    )}
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="organize-foot">
          {confirmEmpty ? (
            <small className="trash-confirm-text">
              <AlertTriangle aria-hidden="true" /> 清空后无法恢复，确定继续？
            </small>
          ) : (
            <small>{entries?.length ? `${entries.length} 个条目` : ""}</small>
          )}
          <div className="confirm-actions">
            {entries && entries.length > 0 &&
              (confirmEmpty ? (
                <>
                  <button type="button" className="button button-secondary" onClick={() => setConfirmEmpty(false)} disabled={emptying}>
                    再想想
                  </button>
                  <button type="button" className="confirm-delete-btn" onClick={() => void emptyAll()} disabled={emptying}>
                    {emptying ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                    {emptying ? "清空中…" : "确认清空"}
                  </button>
                </>
              ) : (
                <button type="button" className="confirm-delete-btn" onClick={() => setConfirmEmpty(true)}>
                  <Trash2 aria-hidden="true" /> 清空回收站
                </button>
              ))}
          </div>
        </footer>
      </div>
    </div>
  );
}

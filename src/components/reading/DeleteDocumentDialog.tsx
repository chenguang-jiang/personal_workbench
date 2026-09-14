"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

export interface DeletableDocument {
  id: string;
  title: string;
  url?: string | null;
}

/**
 * 删除文档确认弹窗。
 * Vault 文章可选择是否同时删除 Obsidian 源文件
 * （不删源文件时，下次 Vault 同步会重新入库）。
 */
export function DeleteDocumentDialog({
  doc,
  onDeleted,
  onClose,
}: {
  doc: DeletableDocument;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const isVault = doc.url?.startsWith("obsidian://") ?? false;
  const [removeFile, setRemoveFile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const query = isVault && removeFile ? "?vault=1" : "";
      const response = await fetch(`/api/articles/${doc.id}${query}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "删除失败");
      }
      onDeleted(doc.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setBusy(false);
    }
  }

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`删除《${doc.title}》`}
      onClick={busy ? undefined : onClose}
    >
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <span className="confirm-dialog-icon" aria-hidden="true">
          <Trash2 />
        </span>
        <h2>删除《{doc.title}》？</h2>
        <p>将从书架移除该文档，它的标注与笔记会一并删除。</p>
        {isVault && (
          <label className="confirm-checkbox">
            <input
              type="checkbox"
              checked={removeFile}
              disabled={busy}
              onChange={(event) => setRemoveFile(event.target.checked)}
            />
            <span>
              <strong>同时删除 Obsidian Vault 中的源文件</strong>
              <small>不勾选则仅从书架移除，下次同步 Vault 时会重新入库</small>
            </span>
          </label>
        )}
        {error && <p className="confirm-error">{error}</p>}
        <div className="confirm-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="confirm-delete-btn"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="ai-spinner" aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            {busy ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { FolderPlus, Loader2, Trash2 } from "lucide-react";

/** 新建文件夹对话框：在当前浏览目录下创建，成功后把新路径回报给页面 */
export function CreateFolderDialog({
  parentPath,
  onCreated,
  onClose,
}: {
  parentPath: string;
  onCreated: (path: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/obsidian/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: parentPath, name: trimmed }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "新建文件夹失败");
      onCreated(String(data.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建文件夹失败");
      setBusy(false);
    }
  }

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="新建文件夹"
      onClick={busy ? undefined : onClose}
    >
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <span className="confirm-dialog-icon" aria-hidden="true">
          <FolderPlus />
        </span>
        <h2>新建文件夹</h2>
        <p>
          将创建在 <strong>{parentPath || "Vault 根目录"}</strong> 下。
        </p>
        <input
          className="folder-dialog-input"
          value={name}
          autoFocus
          maxLength={60}
          placeholder="文件夹名称，如 学习笔记"
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
        <small className="folder-dialog-hint">不能包含 / \ . 等字符，仅支持单层名称。</small>
        {error && <p className="confirm-error">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="button button-purple"
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
          >
            {busy ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <FolderPlus aria-hidden="true" />}
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 删除文件夹确认对话框：空目录直接移除，非空目录整目录进回收站可恢复 */
export function DeleteFolderDialog({
  folderPath,
  folderName,
  fileCount,
  childFolderCount,
  onDeleted,
  onClose,
}: {
  folderPath: string;
  folderName: string;
  fileCount: number;
  childFolderCount: number;
  onDeleted: (path: string) => void;
  onClose: () => void;
}) {
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
      const response = await fetch(`/api/obsidian/folders?path=${encodeURIComponent(folderPath)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "删除文件夹失败");
      onDeleted(folderPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除文件夹失败");
      setBusy(false);
    }
  }

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`删除文件夹 ${folderName}`}
      onClick={busy ? undefined : onClose}
    >
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <span className="confirm-dialog-icon" aria-hidden="true">
          <Trash2 />
        </span>
        <h2>删除「{folderName}」？</h2>
        {fileCount === 0 && childFolderCount === 0 ? (
          <p>这是一个空文件夹，将直接移除。</p>
        ) : (
          <p>
            文件夹内的 <strong>{fileCount} 份资料</strong>
            {childFolderCount > 0 && <>、{childFolderCount} 个子目录</>}
            会一并移入回收站，知识库中的对应条目同时清除；需要时可在回收站整目录恢复。
          </p>
        )}
        {error && <p className="confirm-error">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="confirm-delete-btn" onClick={() => void confirm()} disabled={busy}>
            {busy ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            {busy ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

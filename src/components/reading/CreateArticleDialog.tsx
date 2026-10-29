"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2, PenLine } from "lucide-react";

const DEFAULT_FOLDER = "00-Inbox";

/** 新建文章对话框：在 Vault 选定文件夹（默认 00-Inbox）建空白文档并跳进阅读器编辑态 */
export function CreateArticleDialog({
  onCreated,
  onClose,
}: {
  onCreated: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // 打开时拉一次可归档文件夹清单；失败不阻塞创建（回落到默认 00-Inbox）
  useEffect(() => {
    let cancelled = false;
    fetch("/api/obsidian/folders")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.folders)) setFolders(data.folders);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/articles/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed, folder }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "新建文章失败");
      onCreated();
      router.push(`/reading/${data.articleId}?edit=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建文章失败");
      setBusy(false);
    }
  }

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="新建文章"
      onClick={busy ? undefined : onClose}
    >
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <span className="confirm-dialog-icon" aria-hidden="true">
          <PenLine />
        </span>
        <h2>新建文章</h2>
        <p>
          会在 Vault 的 <strong>{folder}</strong> 下建一个空白文档，并直接进入编辑器。
        </p>
        <label className="create-article-folder">
          <FolderOpen aria-hidden="true" />
          <select
            className="select"
            value={folder}
            disabled={busy}
            aria-label="保存文件夹"
            onChange={(event) => setFolder(event.target.value)}
          >
            {(folders ?? [DEFAULT_FOLDER]).map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <input
          className="folder-dialog-input"
          value={title}
          autoFocus
          maxLength={80}
          placeholder="文章标题，如 我的第一篇笔记"
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
        <small className="folder-dialog-hint">同名文档会自动追加序号，不会覆盖已有文件。</small>
        {error && <p className="confirm-error">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="button button-purple"
            onClick={() => void submit()}
            disabled={busy || !title.trim()}
          >
            {busy ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <PenLine aria-hidden="true" />}
            {busy ? "创建中…" : "创建并编辑"}
          </button>
        </div>
      </div>
    </div>
  );
}

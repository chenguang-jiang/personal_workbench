"use client";

import { useEffect, useState } from "react";
import { Check, Link2, Loader2, Share2, X } from "lucide-react";

/**
 * 分享弹窗：开启后生成免登录链接（/s/<token>），
 * 访客只能看这一篇，且每次打开都是最新版。关闭分享会让旧链接立即失效。
 */
export function ShareDialog({
  articleId,
  title,
  onClose,
}: {
  articleId: string;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shared, setShared] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/articles/${articleId}/share`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setShared(Boolean(data.shared));
        setToken(data.token ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("读取分享状态失败");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/articles/${articleId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "操作失败");
      setShared(Boolean(payload.shared));
      setToken(payload.token ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const shareUrl = token ? `${window.location.origin}/s/${token}` : "";

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时用户可手动选中输入框复制
    }
  }

  return (
    <div
      className="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`分享《${title}》`}
      onClick={busy ? undefined : onClose}
    >
      <div className="confirm-dialog share-dialog" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="share-dialog-close" aria-label="关闭" onClick={onClose}>
          <X />
        </button>
        <span className="confirm-dialog-icon" aria-hidden="true">
          <Share2 />
        </span>
        <h2>分享《{title}》</h2>
        <p>对方无需登录，打开链接即可阅读这一篇；文章更新后，链接里看到的也是最新版。</p>
        {loading ? (
          <p className="share-dialog-status">
            <Loader2 className="ai-spinner" aria-hidden="true" /> 读取分享状态…
          </p>
        ) : (
          <>
            {shared && shareUrl && (
              <div className="share-dialog-link">
                <Link2 aria-hidden="true" />
                <input readOnly value={shareUrl} onFocus={(event) => event.target.select()} />
                <button type="button" className="button button-secondary" onClick={() => void copyLink()}>
                  {copied ? <Check aria-hidden="true" /> : null}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            )}
            {error && <p className="confirm-error">{error}</p>}
            <div className="confirm-actions">
              {shared ? (
                <button
                  type="button"
                  className="confirm-delete-btn"
                  disabled={busy}
                  onClick={() => void toggle(false)}
                >
                  {busy ? <Loader2 className="ai-spinner" aria-hidden="true" /> : null}
                  {busy ? "关闭中…" : "关闭分享"}
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => void toggle(true)}
                >
                  {busy ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <Share2 aria-hidden="true" />}
                  {busy ? "生成中…" : "开启分享并生成链接"}
                </button>
              )}
            </div>
            {shared && (
              <p className="share-dialog-hint">链接只对这一篇生效；关闭分享后，已发出的链接会立即失效。</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

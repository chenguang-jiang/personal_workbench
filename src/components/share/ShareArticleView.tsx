"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Check } from "lucide-react";
import { DawnLogo } from "@/components/brand/DawnLogo";
import { MermaidDiagram } from "@/components/reading/MermaidDiagram";
import { renderMarkdown, splitMermaidBlocks } from "@/lib/reader-markdown";

// 免登录只读分享视图：正文由服务端实时取库后交到这里渲染。
// resolveLinks=false —— 站内链接降级为纯文本，避免把知识库其他文章暴露给访客；
// 图片统一走 /api/share/<token>/asset，服务端只放行正文引用到的资源。
export function ShareArticleView({
  token,
  title,
  summary,
  tags,
  updatedAt,
  content,
}: {
  token: string;
  title: string;
  summary: string | null;
  tags: string[];
  updatedAt: string;
  content: string;
}) {
  const proseRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const blocks = useMemo(() => splitMermaidBlocks(content), [content]);
  const fragmentHtml = useMemo(() => {
    const assetUrl = (cleanSrc: string) =>
      `/api/share/${encodeURIComponent(token)}/asset?path=${encodeURIComponent(cleanSrc)}`;
    return blocks.map((block) =>
      block.type === "mermaid"
        ? ""
        : renderMarkdown(block.content, {}, { assetUrl, resolveLinks: false }),
    );
  }, [blocks, token]);

  // 代码块「复制」按钮（渲染管线生成的 .code-copy-btn）
  useEffect(() => {
    const el = proseRef.current;
    if (!el) return;
    const onClick = (event: Event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".code-copy-btn");
      if (!button) return;
      const text = button.closest("pre")?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard.writeText(text).catch(() => undefined);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [fragmentHtml]);

  // 正文里与标题重复的 H1 视觉隐藏，与阅读器一致
  useEffect(() => {
    const el = proseRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(
      ".reader-markdown-fragment:first-child > h1:first-child",
    );
    if (first && (first.textContent ?? "").trim() === title.trim()) {
      first.classList.add("reader-h1--dup");
    }
  }, [fragmentHtml, title]);

  async function copyLink(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用时静默失败，链接仍显示在地址栏
    }
  }

  return (
    <div className="share-page">
      <header className="share-topbar">
        <div className="share-brand">
          <span className="share-logo" aria-hidden="true">
            <DawnLogo />
          </span>
          <span>DawnKB · 分享阅读</span>
        </div>
        <button type="button" className="share-copy-link" onClick={(event) => void copyLink(event)}>
          {copied ? <Check aria-hidden="true" /> : null}
          {copied ? "已复制" : "复制链接"}
        </button>
      </header>
      <article className="share-document">
        <div className="share-intro">
          <h1 className="share-title">{title}</h1>
          {summary && <p className="share-summary">{summary}</p>}
          <p className="share-meta">
            {tags.length > 0 && (
              <span className="share-tags">
                {tags.map((tag) => (
                  <span key={tag} className="share-tag">#{tag}</span>
                ))}
              </span>
            )}
            <time dateTime={updatedAt}>更新于 {new Date(updatedAt).toLocaleDateString("zh-CN")}</time>
          </p>
        </div>
        <div ref={proseRef} className="reader-prose share-prose">
          {blocks.map((block, index) =>
            block.type === "mermaid" ? (
              <MermaidDiagram source={block.content} key={`mermaid-${index}`} />
            ) : (
              <div
                className="reader-markdown-fragment"
                dangerouslySetInnerHTML={{ __html: fragmentHtml[index] }}
                key={`markdown-${index}`}
              />
            ),
          )}
        </div>
        <footer className="share-footer">
          <p>由 DawnKB 分享 · 内容随作者更新保持最新</p>
        </footer>
      </article>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, FileText, FolderOpen, Loader2, UploadCloud } from "lucide-react";
import styles from "./classic-import.module.css";

export type ClassicImportMode = "file" | "text" | "link";

type Result = { title: string; relativePath?: string; articleId?: string | null; status?: string; indexed?: boolean; reason?: string; warning?: string | null; markdownIndexes?: string[]; error?: string };

/**
 * 传统导入面板：上传文档 / 粘贴正文 / 链接导入三种方式共用一套归档流程。
 * 方式由外部 tab 控制（mode prop），面板自身保持挂载以保留草稿与结果。
 */
export function ClassicImport({ mode }: { mode: ClassicImportMode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [notice, setNotice] = useState("正在检查归档服务…");

  useEffect(() => {
    void fetch("/api/knowledge/import", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      setEnabled(Boolean(data.enabled));
      setNotice(!data.enabled ? "云端归档服务尚未启用" : data.configured ? "DeepSeek 已连接 · 云端独立归档" : "DeepSeek 尚未配置，内容将先保存到待整理");
    }).catch(() => setNotice("暂时无法连接归档服务，请刷新重试"));
  }, []);

  function choose(next: File[]) {
    if (busy) return;
    const accepted = next.filter((file) => /\.(md|txt)$/i.test(file.name) && file.size <= 1024 * 1024);
    setFiles(accepted.slice(0, 10));
    if (accepted.length !== next.length) setNotice("已跳过不支持或大于 1MB 的文件；支持 .md 和 .txt");
  }

  async function send(body: Record<string, unknown>, fallback: string): Promise<Result> {
    try {
      const response = await fetch("/api/knowledge/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "归档失败");
      return data;
    } catch (error) {
      return { title: fallback, error: error instanceof Error ? error.message : "连接失败，请重试" };
    }
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setResults([]);
    try {
      if (mode === "file") {
        for (const file of files) {
          setActive(file.name);
          const result = await send({ filename: file.name, content: (await file.text()).replace(/^\uFEFF/, "") }, file.name);
          setResults((current) => [...current, result]);
        }
      } else {
        setActive(title.trim() || "这篇内容");
        const result = await send(mode === "link" ? { title, url } : { title, content }, title || "未命名内容");
        setResults([result]);
      }
    } finally {
      setBusy(false);
      setActive("");
    }
  }

  async function retryIndex(result: Result, index: number) {
    setBusy(true);
    setActive(result.title);
    const next = await send({ reindexPath: result.relativePath }, result.title);
    setResults((current) => current.map((item, i) => i === index ? { ...item, ...next } : item));
    setBusy(false);
    setActive("");
  }

  return (
    <div className={styles.layout}>
      <section className={`panel ${styles.editor}`} aria-label="导入内容">
        <div>
          {mode === "file" ? <>
            <input ref={inputRef} type="file" accept=".md,.txt,text/markdown,text/plain" multiple className="sr-only" aria-label="选择 Markdown 文档" onChange={(event) => choose(Array.from(event.target.files || []))} disabled={busy} />
            <button type="button" className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`} disabled={busy}
              onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); choose(Array.from(event.dataTransfer.files)); }}>
              <span className={styles.dropIcon}><UploadCloud size={30} strokeWidth={1.4} aria-hidden="true" /></span>
              <strong>{dragging ? "松开，放入知识库" : "把 Markdown 文档拖到这里"}</strong>
              <span>或点击选择文件</span>
              <small>.md / .txt · 单个文件不超过 1MB · 每批最多 10 个</small>
            </button>
            {files.length > 0 && <ul className={styles.files}>{files.map((file, i) => <li key={`${file.name}-${i}`}><FileText size={16} aria-hidden="true" /><span>{file.name}</span><small>{Math.max(1, Math.round(file.size / 1024))} KB</small></li>)}</ul>}
          </> : <div className={styles.textFields}>
            <label htmlFor="import-title">标题 <small>选填，留空由 AI 根据正文生成</small></label>
            <input id="import-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} disabled={busy} placeholder="留空，自动生成文档标题" />
            {mode === "link" ? <><label htmlFor="import-url">网页链接</label><input id="import-url" type="url" className="input" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} placeholder="https://…" /><p className={styles.privacy}>支持公开网页、Markdown 和文本链接。需要登录或动态加载的页面可改用粘贴正文。</p></> : <><label htmlFor="import-content">正文</label>
              <textarea id="import-content" className="textarea" value={content} onChange={(event) => setContent(event.target.value)} disabled={busy} rows={14} placeholder="粘贴文章、笔记或 Markdown 原文…" /></>}
          </div>}
        </div>
        <div className={styles.submitRow}>
          <p className={styles.service}>{notice}</p>
          <button type="button" className="button button-primary" onClick={() => void submit()} disabled={!enabled || busy || (mode === "file" ? !files.length : mode === "link" ? !url.trim() : !content.trim())}>
            {busy ? <Loader2 size={17} className="ai-spinner" aria-hidden="true" /> : <ArrowUpRight size={17} aria-hidden="true" />}
            {busy ? "正在归档…" : "AI 自动归档"}
          </button>
        </div>
        <p className={styles.privacy}>内容会发送至 DeepSeek 识别主题，原文保存在你的云服务器。本地修改不会同步到这里。</p>
      </section>
      <aside className={styles.guide}>
        <span className="micro-label">HOW IT WORKS</span>
        <h2>原文留下，知识归位。</h2>
        <ol><li><strong>识别内容</strong><p>从标题与正文提取主题和标签。</p></li><li><strong>选择目录</strong><p>优先使用已有文件夹，不确定的放入待整理。</p></li><li><strong>更新索引</strong><p>更新阅读、搜索和知识关系，并维护相关 Markdown 索引页。</p></li></ol>
        <div className={styles.versionNote}><FolderOpen size={18} aria-hidden="true" /><p>确认是同一篇文档的新版本时自动更新，并保留上一版；重复上传不会重复创建。</p></div>
      </aside>
      {busy && <p className={styles.progress} role="status">正在处理「{active}」· 识别目录并更新知识库，请稍候。</p>}
      {results.length > 0 && <section className={styles.results} aria-label="归档结果" aria-live="polite">
        <h2>归档结果</h2>
        {results.map((result, index) => <article key={index} className={`panel ${styles.result}`}>
          <CheckCircle2 size={20} aria-hidden="true" className={result.error ? styles.failure : styles.success} />
          <div><span className={styles.badge}>{result.error ? "未完成" : result.status === "updated" ? "已更新 · 旧版已备份" : result.status === "unchanged" ? "已在知识库中" : result.status === "pending" ? "已存入待整理" : result.indexed ? "已归档 · 索引已更新" : "已保存 · 索引待更新"}</span>
            <h3>{result.title}</h3><p>{result.error || result.reason}</p>{result.markdownIndexes?.length ? <p>已更新索引页：{result.markdownIndexes.join("、")}</p> : null}{result.relativePath && <code>{result.relativePath}</code>}{result.warning && <p className={styles.warning}>{result.warning}</p>}
          </div>
          {result.articleId && <Link className="button button-secondary" href={`/reading/${result.articleId}`}>打开文档 <ArrowUpRight size={15} aria-hidden="true" /></Link>}
          {!result.error && !result.indexed && <button className="button button-secondary" disabled={busy} onClick={() => void retryIndex(result, index)}>重试索引</button>}
        </article>)}
      </section>}
    </div>
  );
}

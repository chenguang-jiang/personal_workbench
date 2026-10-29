"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Code,
  FilePen,
  FileText,
  Globe,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  ListOrdered,
  Loader2,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { renderMiniMarkdown } from "@/lib/mini-markdown";

type Source = { url: string; title: string; content: string };
type ImageAttachment = { name: string; preview: string };
type DocAttachment = { name: string; content: string; size: number };
type Turn = {
  role: "user" | "assistant";
  content: string;
  source?: Source;
  images?: ImageAttachment[];
  documents?: DocAttachment[];
};
type Draft = { title: string; summary: string; content: string };
type ArchiveResult = {
  title: string;
  articleId?: string | null;
  relativePath?: string;
  folder?: string;
  status?: string;
  indexed?: boolean;
  reason?: string;
  warning?: string | null;
  error?: string;
};

const SOURCE_SEND_MAX = 60_000;
const ATTACH_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const ATTACH_DOC_MAX_BYTES = 2 * 1024 * 1024;
const ATTACH_MAX_COUNT = 8;

function extractClipboardFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const files: File[] = [];
  if (clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i];
      if (file) files.push(file);
    }
  }
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && !files.some((f) => f.name === file.name && f.size === file.size)) {
          files.push(file);
        }
      }
    }
  }
  return files;
}

function trimSource(source: Source): Source {
  return source.content.length > SOURCE_SEND_MAX
    ? { ...source, content: source.content.slice(0, SOURCE_SEND_MAX) }
    : source;
}

function isUrl(text: string) {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`图片读取失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function readDocumentAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`文档读取失败: ${file.name}`));
    reader.readAsText(file);
  });
}

const AnswerMarkdown = memo(function AnswerMarkdown({ content }: { content: string }) {
  const html = useMemo(() => renderMiniMarkdown(content), [content]);
  return <div className="mini-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
});

const PROMPT_PRESETS = [
  { label: "翻译为中文", icon: Globe, text: "请将附件和内容翻译为流畅的简体中文，并整理出清晰的小节结构。" },
  { label: "梳理知识架构", icon: BookOpen, text: "请梳理核心知识架构、关键机制与优劣势对比，用规范的 Markdown 标题和小节呈现。" },
  { label: "复习考点大纲", icon: ListOrdered, text: "请整理为备考复习大纲，提炼关键概念、重要定义、计算要点与高频考点。" },
  { label: "提取代码实战", icon: Code, text: "请提取其中的核心代码实现与实战踩坑建议，并在代码块中附上详细注释。" },
];

export function AiImportChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [languageReq, setLanguageReq] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [docs, setDocs] = useState<DocAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [vision, setVision] = useState(false);
  const [pendingSource, setPendingSource] = useState<Source | null>(null);
  const [phase, setPhase] = useState<"idle" | "fetching" | "chatting" | "generating" | "archiving">("idle");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [archived, setArchived] = useState<ArchiveResult | null>(null);
  const [archiveEnabled, setArchiveEnabled] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [dragging, setDragging] = useState(false);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = phase !== "idle";

  useEffect(() => {
    void fetch("/api/knowledge/ai-import", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setArchiveEnabled(Boolean(data.archiveEnabled));
        setVision(Boolean(data.vision));
        setConfigured(Boolean(data.configured));
      })
      .catch(() => setArchiveEnabled(false));
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, phase, error, draft, archived, images, docs]);

  async function handleFiles(files: File[]) {
    if (busy || attaching || files.length === 0) return;
    setError("");
    const imageFiles: File[] = [];
    const docFiles: File[] = [];

    for (const file of files) {
      if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
        if (file.size > ATTACH_IMAGE_MAX_BYTES) {
          setError(`图片 ${file.name} 超过 4MB，已跳过`);
          continue;
        }
        imageFiles.push(file);
      } else {
        if (file.size > ATTACH_DOC_MAX_BYTES) {
          setError(`文档 ${file.name} 超过 2MB，已跳过`);
          continue;
        }
        docFiles.push(file);
      }
    }

    const availableSlots = ATTACH_MAX_COUNT - (images.length + docs.length);
    if (availableSlots <= 0) {
      setError(`每轮最多附加 ${ATTACH_MAX_COUNT} 个附件`);
      return;
    }

    setAttaching(true);
    try {
      if (docFiles.length > 0) {
        const allowedDocs = docFiles.slice(0, availableSlots);
        const readDocs = await Promise.all(
          allowedDocs.map(async (file) => ({
            name: file.name,
            content: (await readDocumentAsText(file)).replace(/^\uFEFF/, ""),
            size: file.size,
          })),
        );
        setDocs((prev) => [...prev, ...readDocs]);
      }

      if (imageFiles.length > 0) {
        const remainingSlots = availableSlots - docFiles.length;
        if (remainingSlots > 0) {
          const allowedImages = imageFiles.slice(0, remainingSlots);
          const dataUrls = await Promise.all(allowedImages.map(readAsDataUrl));
          const response = await fetch("/api/knowledge/ai-import/attach-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ images: dataUrls }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "图片保存失败");
          const saved = data.images as { name: string }[];
          setImages((prev) => [
            ...prev,
            ...saved.map((item, i) => ({ name: item.name, preview: dataUrls[i] })),
          ]);
        }
      }
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : "附件处理失败");
    } finally {
      setAttaching(false);
    }
  }

  function handlePaste(event: React.ClipboardEvent) {
    const files = extractClipboardFiles(event.clipboardData);
    if (files.length > 0) {
      event.preventDefault();
      void handleFiles(files);
      return;
    }
    const isInputFocused =
      document.activeElement?.tagName === "TEXTAREA" ||
      document.activeElement?.tagName === "INPUT";
    if (!isInputFocused) {
      const text = event.clipboardData?.getData("text/plain");
      if (text) {
        event.preventDefault();
        setInput((prev) => (prev ? `${prev}\n${text}` : text));
      }
    }
  }

  function composeUserPrompt(rawText: string, customReq: string): string {
    const parts: string[] = [];
    if (rawText.trim()) parts.push(rawText.trim());
    if (customReq.trim()) {
      parts.push(`【语言与整理要求】\n${customReq.trim()}`);
    }
    if (parts.length === 0) {
      if (docs.length > 0 && images.length > 0) {
        parts.push("请结合我上传的文档与图片附件，整理成一篇条理清晰的知识库文章。");
      } else if (docs.length > 0) {
        parts.push("请仔细阅读我上传的文档附件，提炼其核心内容并整理成知识库文章。");
      } else if (images.length > 0) {
        parts.push("请查看我上传的图片，提炼其中信息并形成结构化笔记。");
      }
    }
    return parts.join("\n\n");
  }

  async function resolveUrlSource(urlStr: string): Promise<Source | null> {
    try {
      const response = await fetch("/api/knowledge/ai-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch", url: urlStr }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "网页读取失败");
      return trimSource(data.source as Source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网页读取失败");
      return null;
    }
  }

  async function sendText(raw: string) {
    const prompt = composeUserPrompt(raw, languageReq);
    if (!prompt && images.length === 0 && docs.length === 0) return;
    if (busy) return;

    const currentImages = images;
    const currentDocs = docs;
    setInput("");
    setImages([]);
    setDocs([]);
    setError("");

    const turn: Turn = {
      role: "user",
      content: prompt,
      images: currentImages.length ? currentImages : undefined,
      documents: currentDocs.length ? currentDocs : undefined,
    };

    if (currentImages.length === 0 && currentDocs.length === 0 && isUrl(raw.trim())) {
      setPhase("fetching");
      setTurns((current) => [...current, turn]);
      const source = await resolveUrlSource(raw.trim());
      setPhase("idle");
      if (source) {
        setPendingSource(source);
        setTurns((current) => [
          ...current,
          {
            role: "assistant",
            content: `已成功读取网页《${source.title || raw.trim()}》（约 ${source.content.length} 字）。已记录你的语言要求：「${languageReq || "结构化提炼归档"}」。可以直接点击下方的「生成文章」或输入追问讨论。`,
          },
        ]);
      } else {
        setTurns((current) => [
          ...current,
          {
            role: "assistant",
            content: "该网页未能成功读取（可能是动态页面或需登录）。建议将正文复制后直接粘贴到输入框。",
          },
        ]);
      }
      return;
    }

    const source = pendingSource;
    setPendingSource(null);
    const userTurn: Turn = source ? { ...turn, source } : turn;
    const newHistory = [...turns, userTurn];
    setTurns([...newHistory, { role: "assistant", content: "" }]);
    setPhase("chatting");
    await streamChat(newHistory);
  }

  async function streamChat(history: Turn[]) {
    try {
      const response = await fetch("/api/knowledge/ai-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          messages: history.map((turn) => ({
            role: turn.role,
            content: turn.content,
            source: turn.source,
            images: turn.images?.map((image) => image.name),
            documents: turn.documents?.map((d) => ({ name: d.name, content: d.content })),
          })),
        }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "AI 对话失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setTurns((current) => {
          const next = [...current];
          next[next.length - 1] = { role: "assistant", content: text };
          return next;
        });
      }
      if (!text.trim()) throw new Error("AI 没有返回内容，请重试");
    } catch (streamError) {
      setError(streamError instanceof Error ? streamError.message : "AI 对话失败");
      setTurns((current) => current.slice(0, -1));
    } finally {
      setPhase("idle");
    }
  }

  async function generateFromHistory(history: Turn[]) {
    if (history.length === 0) return null;
    setError("");
    setPhase("generating");
    try {
      const response = await fetch("/api/knowledge/ai-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          title: draftTitle,
          messages: history.map((turn) => ({
            role: turn.role,
            content: turn.content,
            source: turn.source,
            images: turn.images?.map((image) => image.name),
            documents: turn.documents?.map((d) => ({ name: d.name, content: d.content })),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "生成失败");
      const generatedDraft = data.draft as Draft;
      setDraft(generatedDraft);
      setArchived(null);
      return generatedDraft;
    } catch (genErr) {
      setError(genErr instanceof Error ? genErr.message : "生成文章失败");
      return null;
    } finally {
      setPhase("idle");
    }
  }

  async function executeDirectArchive() {
    if (busy) return;
    const prompt = composeUserPrompt(input, languageReq);
    if (!prompt && images.length === 0 && docs.length === 0) {
      setError("请至少上传一个附件、粘贴正文或输入网页链接");
      return;
    }

    const currentImages = images;
    const currentDocs = docs;
    const isLink = currentImages.length === 0 && currentDocs.length === 0 && isUrl(input.trim());

    let source: Source | null = pendingSource;
    if (isLink) {
      setPhase("fetching");
      source = await resolveUrlSource(input.trim());
      setPhase("idle");
      if (!source) return;
    }

    setInput("");
    setImages([]);
    setDocs([]);
    setError("");

    const userTurn: Turn = {
      role: "user",
      content: prompt,
      source: source || undefined,
      images: currentImages.length ? currentImages : undefined,
      documents: currentDocs.length ? currentDocs : undefined,
    };

    const nextHistory = [...turns, userTurn];
    setTurns(nextHistory);

    const generated = await generateFromHistory(nextHistory);
    if (!generated) return;

    setPhase("archiving");
    try {
      const response = await fetch("/api/knowledge/ai-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "archive",
          draft: { ...generated, title: draftTitle.trim() || generated.title },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "归档失败");
      setArchived(data as ArchiveResult);
    } catch (arcErr) {
      setError(arcErr instanceof Error ? arcErr.message : "归档失败");
    } finally {
      setPhase("idle");
    }
  }

  async function archiveDraft() {
    if (busy || !draft) return;
    setError("");
    setPhase("archiving");
    try {
      const response = await fetch("/api/knowledge/ai-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "archive",
          draft: { ...draft, title: draftTitle.trim() || draft.title },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "归档失败");
      setArchived(data as ArchiveResult);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "归档失败");
    } finally {
      setPhase("idle");
    }
  }

  function resetAll() {
    setTurns([]);
    setInput("");
    setLanguageReq("");
    setImages([]);
    setDocs([]);
    setDraft(null);
    setArchived(null);
    setError("");
    setPendingSource(null);
  }

  const hasContent = input.trim().length > 0 || images.length > 0 || docs.length > 0;
  const canSend = !busy && !attaching && hasContent;
  const canGenerate = turns.some((turn) => turn.role === "assistant" && turn.content.trim());

  return (
    <section className="ai-import-panel panel" onPaste={handlePaste} aria-label="AI 智能导入">
      <div
        className={`ai-import-thread ${dragging ? "ai-import-drop-active" : ""}`}
        ref={threadRef}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(Array.from(e.dataTransfer.files || []));
        }}
      >
        {turns.length === 0 && !draft && !archived && (
          <div className="ai-import-hero">
            <div className="ai-import-hero-pill">
              <Sparkles size={13} className="text-amber-500" aria-hidden="true" />
              <span>全能智能导入工作台</span>
            </div>
            <h2>让外部资料，一步沉淀为知识库文章</h2>
            <p>
              拖入或上传文档与图片附件，或直接粘贴正文与网页链接。输入自定义语言与整理指令，AI 自动完成出版级排版并归档入库。
            </p>
          </div>
        )}

        {/* 对话轮次 */}
        {turns.map((turn, index) => (
          <div key={index} className={`ai-import-turn ai-import-turn--${turn.role}`}>
            {turn.source && (
              <p className="ai-import-source">
                <Link2 size={13} aria-hidden="true" />
                <a href={turn.source.url} target="_blank" rel="noopener noreferrer">
                  {turn.source.title || turn.source.url}
                </a>
                <small>约 {turn.source.content.length} 字已读入</small>
              </p>
            )}
            {turn.documents && turn.documents.length > 0 && (
              <div className="ai-import-turn-docs">
                {turn.documents.map((d) => (
                  <span key={d.name} className="ai-import-doc-pill">
                    <FileText size={13} aria-hidden="true" />
                    <span>{d.name}</span>
                    <small>({Math.max(1, Math.round(d.size / 1024))} KB)</small>
                  </span>
                ))}
              </div>
            )}
            {turn.images && turn.images.length > 0 && (
              <div className="ai-import-turn-images">
                {turn.images.map((image) => (
                  <img key={image.name} src={image.preview} alt={image.name} title={image.name} />
                ))}
              </div>
            )}
            {turn.role === "assistant" && !turn.content ? (
              <p className="ai-import-thinking">
                <Loader2 size={14} className="ai-spinner" aria-hidden="true" /> 正在根据要求思考和组织内容…
              </p>
            ) : turn.role === "assistant" ? (
              <AnswerMarkdown content={turn.content} />
            ) : (
              <p className="ai-import-user-text">{turn.content}</p>
            )}
          </div>
        ))}

        {phase === "fetching" && (
          <p className="ai-import-status" role="status">
            <Loader2 size={14} className="ai-spinner" aria-hidden="true" /> 正在抓取公开网页正文…
          </p>
        )}
        {phase === "generating" && (
          <p className="ai-import-status" role="status">
            <Loader2 size={14} className="ai-spinner" aria-hidden="true" /> 正在按语言要求生成结构化知识库文章…
          </p>
        )}
        {phase === "archiving" && (
          <p className="ai-import-status" role="status">
            <Loader2 size={14} className="ai-spinner" aria-hidden="true" /> 正在写入 Vault 并同步检索索引…
          </p>
        )}

        {error && <p className="ai-import-error" role="alert">{error}</p>}

        {/* 归档成功卡片 */}
        {archived && (
          <div className={`ai-import-success-card ${archived.error ? "is-error" : ""}`}>
            <div className="ai-import-success-head">
              <CheckCircle2 size={20} className="text-emerald-500" aria-hidden="true" />
              <h3>{archived.error ? "归档遇到问题" : "文章已成功归档入库！"}</h3>
            </div>
            {archived.error ? (
              <p className="ai-import-success-desc">{archived.error}</p>
            ) : (
              <div className="ai-import-success-body">
                <p>
                  文章：<strong>{archived.title}</strong>
                </p>
                <p>
                  归档目录：<code>{archived.folder || "JCG/00-Inbox"}</code>
                  {archived.relativePath ? ` (${archived.relativePath})` : ""}
                </p>
                <p className="ai-import-success-status">
                  ✓ 知识图谱已关联 · 全文检索已就绪 · Markdown 索引已更新
                </p>
              </div>
            )}
            <div className="ai-import-success-actions">
              {archived.articleId && (
                <Link href={`/reading/${archived.articleId}`} className="button button-primary">
                  打开文档阅读 <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              )}
              <button type="button" className="button button-secondary" onClick={resetAll}>
                <RotateCcw size={14} aria-hidden="true" /> 继续导入下一篇
              </button>
            </div>
          </div>
        )}

        {/* 文章草稿预览 */}
        {draft && !archived && (
          <div className="ai-import-draft">
            <div className="ai-import-draft-head">
              <FilePen size={16} aria-hidden="true" />
              <input
                className="input"
                value={draftTitle || draft.title}
                onChange={(event) => setDraftTitle(event.target.value)}
                maxLength={80}
                aria-label="文章标题"
                disabled={busy}
              />
            </div>
            {draft.summary && <p className="ai-import-draft-summary">{draft.summary}</p>}
            <div
              className="mini-markdown ai-import-draft-body"
              dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(draft.content) }}
            />
            <div className="ai-import-draft-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void generateFromHistory(turns)}
                disabled={busy}
              >
                重新生成
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={archiveDraft}
                disabled={busy || !archiveEnabled}
                title={archiveEnabled ? "" : "归档服务尚未启用"}
              >
                {phase === "archiving" ? (
                  <Loader2 size={15} className="ai-spinner" aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={15} aria-hidden="true" />
                )}
                确认归档入库
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 统一输入工作台 */}
      <div className="ai-import-composer">
        <div className="ai-import-studio-card">
          {/* 附件展示条 (在卡片内顶部) */}
          {(images.length > 0 || docs.length > 0 || attaching) && (
            <div className="ai-import-attach-bar">
              {attaching && (
                <span className="ai-import-attach-pending">
                  <Loader2 size={13} className="ai-spinner" aria-hidden="true" /> 附件解析保存中…
                </span>
              )}
              {docs.map((doc) => (
                <span key={doc.name} className="ai-import-doc-chip">
                  <FileText size={13} aria-hidden="true" />
                  <span className="ai-import-doc-name" title={doc.name}>
                    {doc.name}
                  </span>
                  <small>({Math.max(1, Math.round(doc.size / 1024))} KB)</small>
                  <button
                    type="button"
                    aria-label={`移除文档 ${doc.name}`}
                    disabled={busy}
                    onClick={() => setDocs((current) => current.filter((item) => item.name !== doc.name))}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              ))}
              {images.map((image) => (
                <span key={image.name} className="ai-import-attach-chip">
                  <img src={image.preview} alt={image.name} />
                  <button
                    type="button"
                    aria-label={`移除图片 ${image.name}`}
                    disabled={busy}
                    onClick={() => setImages((current) => current.filter((item) => item.name !== image.name))}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* 主输入区（正文或链接） */}
          <textarea
            ref={composerRef}
            className="ai-import-main-input"
            rows={3}
            value={input}
            placeholder="粘贴正文、Markdown 文本、输入网页公开链接 (https://...)，或直接按 Cmd+V 粘贴截图/拖入文件…"
            aria-label="导入内容或对话"
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void executeDirectArchive();
              }
            }}
          />

          {/* 语言要求与快捷指令 (整合在卡片内) */}
          <div className="ai-import-directive-row">
            <div className="ai-import-directive-input-wrap">
              <Sparkles size={13} className="ai-import-directive-icon" aria-hidden="true" />
              <input
                className="ai-import-directive-input"
                value={languageReq}
                onChange={(e) => setLanguageReq(e.target.value)}
                placeholder="语言要求与整理指令（选填）：如“翻译为中文并按模块梳理考点”、“提炼核心代码”..."
                disabled={busy}
              />
            </div>
            <div className="ai-import-presets">
              {PROMPT_PRESETS.map((preset) => {
                const Icon = preset.icon;
                const isSelected = languageReq === preset.text;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className={`ai-import-preset-chip ${isSelected ? "is-selected" : ""}`}
                    onClick={() => setLanguageReq(isSelected ? "" : preset.text)}
                    disabled={busy}
                  >
                    <Icon size={12} aria-hidden="true" />
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 卡片底部操作栏 */}
          <div className="ai-import-bottom-bar">
            <div className="ai-import-bottom-left">
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.json,.csv,.docx,.pdf,image/png,image/jpeg,image/gif,image/webp,image/bmp"
                multiple
                className="sr-only"
                aria-label="添加附件"
                onChange={(event) => {
                  void handleFiles(Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="button button-secondary ai-import-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || attaching || images.length + docs.length >= ATTACH_MAX_COUNT}
                title={`上传附件（支持 Markdown、TXT 文档与图片，最多 ${ATTACH_MAX_COUNT} 个）`}
                aria-label="上传附件"
              >
                {attaching ? (
                  <Loader2 size={14} className="ai-spinner" aria-hidden="true" />
                ) : (
                  <Paperclip size={14} aria-hidden="true" />
                )}
                <span>添加附件</span>
              </button>

              {(images.length > 0 || docs.length > 0) && (
                <span className="ai-import-count-tag">
                  已选 {images.length + docs.length} 个附件
                </span>
              )}

              {(turns.length > 0 || input || images.length > 0 || docs.length > 0 || draft) && (
                <button
                  type="button"
                  className="ai-import-clear-btn"
                  onClick={resetAll}
                  disabled={busy}
                  title="清空当前输入与对话"
                >
                  <Trash2 size={13} aria-hidden="true" /> 清空
                </button>
              )}
            </div>

            <div className="ai-import-bottom-right">
              <button
                type="button"
                className="button button-secondary ai-import-chat-btn"
                onClick={() => sendText(input)}
                disabled={!canSend}
                title="先与 AI 交流讨论 / 审阅草稿"
                aria-label="发送对话"
              >
                <Send size={14} aria-hidden="true" />
                <span>AI 讨论审阅</span>
              </button>

              <button
                type="button"
                className="button button-primary ai-import-direct-btn"
                onClick={() => void executeDirectArchive()}
                disabled={!canSend || !archiveEnabled}
                title="根据附件、内容与语言要求，直接生成文章并归档入库 (⌘ + Enter)"
                aria-label="一键归档入库"
              >
                <Sparkles size={14} aria-hidden="true" />
                <span>一键 AI 归档</span>
              </button>
            </div>
          </div>
        </div>

        <p className="ai-import-hint">
          支持直接拖入文档与图片 · 快捷键 <code>⌘ + Enter</code> 一键归档
          {vision ? " · 模型支持图文多模态解析" : " · 图片附件将自动嵌入正文引用"}
        </p>
      </div>
    </section>
  );
}

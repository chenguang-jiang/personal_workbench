"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  FilePen,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  Loader2,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { renderMiniMarkdown } from "@/lib/mini-markdown";

type Source = { url: string; title: string; content: string };
type Attachment = { name: string; preview: string };
type Turn = { role: "user" | "assistant"; content: string; source?: Source; images?: Attachment[] };
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

/** 回传服务端的网页正文上限：够模型讨论，也控制请求体大小 */
const SOURCE_SEND_MAX = 60_000;
/** 与后端 import-assets 保持一致：单张 4MB、每轮 4 张 */
const ATTACH_MAX_BYTES = 4 * 1024 * 1024;
const ATTACH_MAX_COUNT = 4;

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
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

const AnswerMarkdown = memo(function AnswerMarkdown({ content }: { content: string }) {
  const html = useMemo(() => renderMiniMarkdown(content), [content]);
  return <div className="mini-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
});

export function AiImportChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [vision, setVision] = useState(false);
  const [pendingSource, setPendingSource] = useState<Source | null>(null);
  const [phase, setPhase] = useState<"idle" | "fetching" | "chatting" | "generating" | "archiving">("idle");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [archived, setArchived] = useState<ArchiveResult | null>(null);
  const [archiveEnabled, setArchiveEnabled] = useState(true);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const busy = phase !== "idle";

  useEffect(() => {
    void fetch("/api/knowledge/ai-import", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setArchiveEnabled(Boolean(data.archiveEnabled));
        setVision(Boolean(data.vision));
      })
      .catch(() => setArchiveEnabled(false));
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, phase, error, draft, archived, attachments]);

  async function attachFiles(files: File[]) {
    if (busy || attaching) return;
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      setError("只支持图片附件（PNG / JPG / GIF / WebP / BMP）");
      return;
    }
    const room = ATTACH_MAX_COUNT - attachments.length;
    if (room <= 0) {
      setError(`每轮最多附加 ${ATTACH_MAX_COUNT} 张图片`);
      return;
    }
    const accepted = images.slice(0, room).filter((file) => file.size <= ATTACH_MAX_BYTES);
    if (accepted.length !== images.slice(0, room).length) setError("已跳过超过 4MB 的图片");
    if (images.length > room) setError(`每轮最多附加 ${ATTACH_MAX_COUNT} 张图片，多余的已忽略`);
    if (accepted.length === 0) return;
    setAttaching(true);
    setError("");
    try {
      const dataUrls = await Promise.all(accepted.map(readAsDataUrl));
      const response = await fetch("/api/knowledge/ai-import/attach-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: dataUrls }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "图片保存失败");
      const saved = data.images as { name: string }[];
      setAttachments((current) => [
        ...current,
        ...saved.map((item, i) => ({ name: item.name, preview: dataUrls[i] })),
      ]);
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : "图片保存失败");
    } finally {
      setAttaching(false);
    }
  }

  function sendText(raw: string) {
    const content = raw.trim() || (attachments.length ? "请看我附带的图片，说说里面有什么、哪些值得记进知识库。" : "");
    if (!content || busy) return;
    const images = attachments;
    setInput("");
    setAttachments([]);
    setError("");
    const turn: Turn = { role: "user", content, images: images.length ? images : undefined };
    if (images.length === 0 && isUrl(content)) {
      setPhase("fetching");
      setTurns((current) => [...current, turn]);
      void fetch("/api/knowledge/ai-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch", url: content }),
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "网页读取失败");
          const source = trimSource(data.source as Source);
          setPendingSource(source);
          setTurns((current) => [...current, {
            role: "assistant",
            content: `已读取网页${source.title ? `《${source.title}》` : ""}，共约 ${source.content.length} 字。想让我怎么消化它？比如：提炼要点、分析论证、对比你已有的笔记，或者直接说「生成文章」。`,
          }]);
        })
        .catch((fetchError) => {
          setError(fetchError instanceof Error ? fetchError.message : "网页读取失败");
          setTurns((current) => [...current, {
            role: "assistant",
            content: "这个链接没能读取成功（可能需要登录、是动态页面，或不是公开网页）。你可以把正文直接粘贴给我，我们照样能讨论并生成文章。",
          }]);
        })
        .finally(() => setPhase("idle"));
      return;
    }
    const source = pendingSource;
    setPendingSource(null);
    const userTurn: Turn = source ? { ...turn, source } : turn;
    setTurns((current) => [...current, userTurn, { role: "assistant", content: "" }]);
    setPhase("chatting");
    void streamChat([...turns, userTurn]);
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

  function generate() {
    if (busy || turns.length === 0) return;
    setError("");
    setPhase("generating");
    void fetch("/api/knowledge/ai-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate",
        title: draftTitle,
        messages: turns.map((turn) => ({
          role: turn.role,
          content: turn.content,
          source: turn.source,
          images: turn.images?.map((image) => image.name),
        })),
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "生成失败");
        setDraft(data.draft as Draft);
        setArchived(null);
      })
      .catch((generateError) => setError(generateError instanceof Error ? generateError.message : "生成失败"))
      .finally(() => setPhase("idle"));
  }

  function archive() {
    if (busy || !draft) return;
    setError("");
    setPhase("archiving");
    void fetch("/api/knowledge/ai-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive", draft: { ...draft, title: draftTitle.trim() || draft.title } }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "归档失败");
        setArchived(data as ArchiveResult);
      })
      .catch((archiveError) => setError(archiveError instanceof Error ? archiveError.message : "归档失败"))
      .finally(() => setPhase("idle"));
  }

  const canGenerate = turns.some((turn) => turn.role === "assistant" && turn.content.trim());
  const canSend = !busy && !attaching && (input.trim().length > 0 || attachments.length > 0);

  return (
    <section className="ai-import-panel panel" aria-label="AI 导入对话">
      <div className="ai-import-thread" ref={threadRef}>
        {turns.length === 0 && (
          <div className="ai-import-start">
            <Sparkles aria-hidden="true" />
            <h2>聊明白，再入库。</h2>
            <p>丢一个链接、几张截图，或直接粘贴正文和想法：我陪你把内容读透、聊透，满意后一键生成结构化文章，归档进知识库。</p>
            <div className="ai-import-start-modes">
              <span><Link2 size={14} aria-hidden="true" />链接解读</span>
              <span><ImageIcon size={14} aria-hidden="true" />图片讨论</span>
              <span><FileText size={14} aria-hidden="true" />正文粘贴</span>
            </div>
          </div>
        )}
        {turns.map((turn, index) => (
          <div key={index} className={`ai-import-turn ai-import-turn--${turn.role}`}>
            {turn.source && (
              <p className="ai-import-source">
                <Link2 size={13} aria-hidden="true" />
                <a href={turn.source.url} target="_blank" rel="noopener noreferrer">{turn.source.title || turn.source.url}</a>
                <small>约 {turn.source.content.length} 字已读入</small>
              </p>
            )}
            {turn.images && turn.images.length > 0 && (
              <div className="ai-import-turn-images">
                {turn.images.map((image) => (
                  <img key={image.name} src={image.preview} alt={image.name} title={image.name} />
                ))}
              </div>
            )}
            {turn.role === "assistant" && !turn.content ? (
              <p className="ai-import-thinking"><Loader2 size={14} className="ai-spinner" aria-hidden="true" /> 正在思考…</p>
            ) : turn.role === "assistant" ? (
              <AnswerMarkdown content={turn.content} />
            ) : (
              <p className="ai-import-user-text">{turn.content}</p>
            )}
          </div>
        ))}
        {phase === "fetching" && (
          <p className="ai-import-status" role="status"><Loader2 size={14} className="ai-spinner" aria-hidden="true" /> 正在读取网页…</p>
        )}
        {phase === "generating" && (
          <p className="ai-import-status" role="status"><Loader2 size={14} className="ai-spinner" aria-hidden="true" /> 正在把对话沉淀成文章…</p>
        )}
        {error && <p className="ai-import-error" role="alert">{error}</p>}
        {draft && (
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
            <div className="mini-markdown ai-import-draft-body" dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(draft.content) }} />
            <div className="ai-import-draft-actions">
              <button type="button" className="button button-secondary" onClick={generate} disabled={busy}>
                重新生成
              </button>
              <button type="button" className="button button-primary" onClick={archive} disabled={busy || !archiveEnabled} title={archiveEnabled ? "" : "归档服务尚未启用"}>
                {phase === "archiving" ? <Loader2 size={15} className="ai-spinner" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
                归档进知识库
              </button>
            </div>
            {archived && (
              <p className={`ai-import-archived ${archived.error ? "is-error" : ""}`}>
                {archived.error ? archived.error : (
                  <>
                    已归档到 {archived.folder || "知识库"}{archived.relativePath ? `（${archived.relativePath}）` : ""}
                    {archived.articleId && (
                      <Link href={`/reading/${archived.articleId}`}>打开文档 <ArrowUpRight size={13} aria-hidden="true" /></Link>
                    )}
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="ai-import-composer">
        {(attachments.length > 0 || attaching) && (
          <div className="ai-import-attach-bar">
            {attaching && <span className="ai-import-attach-pending"><Loader2 size={14} className="ai-spinner" aria-hidden="true" /> 图片保存中…</span>}
            {attachments.map((image) => (
              <span key={image.name} className="ai-import-attach-chip">
                <img src={image.preview} alt={image.name} />
                <button
                  type="button"
                  aria-label={`移除图片 ${image.name}`}
                  disabled={busy}
                  onClick={() => setAttachments((current) => current.filter((item) => item.name !== image.name))}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="ai-import-composer-row">
          <textarea
            ref={composerRef}
            rows={2}
            value={input}
            placeholder="粘贴链接、正文或想法，也可以附加图片一起讨论…"
            aria-label="对话输入"
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.items ?? [])
                .filter((item) => item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
              if (files.length > 0) {
                event.preventDefault();
                void attachFiles(files);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendText(input);
              }
            }}
          />
          <div className="ai-import-composer-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              multiple
              className="sr-only"
              aria-label="附加图片"
              onChange={(event) => {
                void attachFiles(Array.from(event.target.files || []));
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="button button-secondary ai-import-attach"
              onClick={() => fileRef.current?.click()}
              disabled={busy || attaching || attachments.length >= ATTACH_MAX_COUNT}
              title={`附加图片（PNG / JPG / GIF / WebP，单张 ≤4MB，每轮最多 ${ATTACH_MAX_COUNT} 张）`}
              aria-label="附加图片"
            >
              {attaching ? <Loader2 size={16} className="ai-spinner" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
            </button>
            <button type="button" className="button button-primary ai-import-send" onClick={() => sendText(input)} disabled={!canSend} aria-label="发送">
              <Send size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="ai-import-composer-foot">
          <p className="ai-import-hint">
            Enter 发送 · Shift+Enter 换行 · 可附加或直接粘贴图片
            {vision ? "（模型会看图讨论）" : "（图片随文章保存，当前模型以文字讨论为准）"}
            {" · 链接由服务端读取，仅公开网页"}
          </p>
          <button type="button" className="button button-secondary" onClick={generate} disabled={busy || !canGenerate}>
            {phase === "generating" ? <Loader2 size={15} className="ai-spinner" aria-hidden="true" /> : <FilePen size={15} aria-hidden="true" />}
            生成文章
          </button>
        </div>
      </div>
    </section>
  );
}

"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BotMessageSquare,
  Check,
  FileText,
  Loader2,
  Paperclip,
  PenLine,
  X,
} from "lucide-react";
import { renderMiniMarkdown } from "@/lib/mini-markdown";

export type AiChatSelection = { text: string; context: string } | null;

type ChatAttachment = {
  id: string;
  name: string;
  type: "image" | "document";
  preview?: string;
  content?: string;
  ref?: string;
  size: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
};

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

/** 每条 AI 回答只在完成后才走 Markdown 渲染；流式中的消息保持纯文本避免闪烁 */
const AnswerBody = memo(function AnswerBody({ content }: { content: string }) {
  return (
    <div
      className="mini-markdown"
      dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(content) }}
    />
  );
});

export function ReaderAiChat({
  articleId,
  articleTitle,
  articleContent,
  selection,
  initialQuestion,
  onClose,
  onApplyEdit,
}: {
  articleId: string;
  articleTitle: string;
  articleContent: string;
  selection: AiChatSelection;
  initialQuestion: string;
  onClose: () => void;
  onApplyEdit: (content: string) => Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(initialQuestion);
  const [mode, setMode] = useState<"ask" | "edit">("ask");
  const [streaming, setStreaming] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 进入面板时的选区固定为本轮引用；不随正文新选区漂移
  const [quoted] = useState(selection);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, pendingEdit, streaming]);

  // 卸载时掐断未完成的流
  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleFiles(files: File[]) {
    if (streaming || proposing || applying || attaching || files.length === 0) return;
    setError("");
    const availableSlots = 4 - attachments.length;
    if (availableSlots <= 0) {
      setError("每轮对话最多附加 4 个附件");
      return;
    }

    setAttaching(true);
    try {
      for (const file of files.slice(0, availableSlots)) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
          if (file.size > 4 * 1024 * 1024) {
            setError(`图片 ${file.name} 超过 4MB，已跳过`);
            continue;
          }
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error(`读取图片失败: ${file.name}`));
            reader.readAsDataURL(file);
          });
          const response = await fetch("/api/knowledge/ai-import/attach-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ images: [dataUrl] }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "图片保存失败");
          const saved = (data.images as Array<{ name: string; ref: string }>)[0];
          setAttachments((prev) => [
            ...prev,
            {
              id,
              name: saved.name,
              type: "image",
              preview: dataUrl,
              ref: saved.ref,
              size: file.size,
            },
          ]);
        } else {
          if (file.size > 2 * 1024 * 1024) {
            setError(`文档 ${file.name} 超过 2MB，已跳过`);
            continue;
          }
          const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error(`读取文档失败: ${file.name}`));
            reader.readAsText(file);
          });
          setAttachments((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              type: "document",
              content: text.replace(/^\uFEFF/, ""),
              size: file.size,
            },
          ]);
        }
      }
    } catch (attachErr) {
      setError(attachErr instanceof Error ? attachErr.message : "附件处理失败");
    } finally {
      setAttaching(false);
    }
  }

  const [dragging, setDragging] = useState(false);

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

  // 打开面板即预填的问题（如“总结全文”的预设提问）自动发送一次
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (autoSentRef.current || !initialQuestion.trim()) return;
    autoSentRef.current = true;
    void send(initialQuestion.trim());
    setInput("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string) {
    let question = text.trim();
    if ((!question && attachments.length === 0) || streaming || proposing || applying || attaching) return;
    const currentAttachments = attachments;
    setAttachments([]);

    if (!question && currentAttachments.length > 0) {
      if (mode === "edit") {
        question = "请参考附带的图片/文档内容，对文章进行相应修改与补充。";
      } else {
        const hasImg = currentAttachments.some((a) => a.type === "image");
        const hasDoc = currentAttachments.some((a) => a.type === "document");
        if (hasImg && hasDoc) {
          question = "请结合我附带的图片与文档，分析并回答相关问题。";
        } else if (hasImg) {
          question = "请帮我分析这张图片的内容，并结合文章进行解答。";
        } else {
          question = "请阅读附带的文档内容，并结合文章进行解答。";
        }
      }
    }

    if (mode === "edit") {
      await proposeEdit(question, currentAttachments);
      return;
    }

    let userPrompt = question;
    if (currentAttachments.length > 0) {
      const docTexts = currentAttachments
        .filter((a) => a.type === "document" && a.content)
        .map((a) => `【附带文档（${a.name}）】：\n${a.content!.slice(0, 8000)}`)
        .join("\n\n");
      const imgTexts = currentAttachments
        .filter((a) => a.type === "image")
        .map((a) => `【附带图片】：${a.name}（引用标记：${a.ref || a.name}）`)
        .join("、");
      userPrompt = [question, docTexts, imgTexts].filter(Boolean).join("\n\n");
    }

    const currentImages = currentAttachments
      .filter((a) => a.type === "image" && a.preview)
      .map((a) => a.preview!);

    const userMessage: ChatMessage = {
      role: "user",
      content: quoted?.text ? `关于这段原文：「${quoted.text.slice(0, 300)}」\n\n${userPrompt}` : userPrompt,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    };

    const historyForModel = [
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
        images: m.attachments
          ?.filter((a) => a.type === "image" && a.preview)
          .map((a) => a.preview!),
      })),
      {
        role: "user" as const,
        content: userMessage.content,
        images: currentImages.length > 0 ? currentImages : undefined,
      },
    ];

    setMessages([...messages, userMessage]);
    setInput("");
    setError("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let answer = "";
    setMessages([...messages, userMessage, { role: "assistant", content: "" }]);
    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          articleTitle,
          articleContent,
          selection: quoted?.text ?? "",
          history: historyForModel,
        }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "AI 请求失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages((current) => {
          const next = [...current];
          next[next.length - 1] = { role: "assistant", content: answer };
          return next;
        });
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "AI 请求失败");
      setMessages((current) =>
        // 空回答的占位消息直接移除，保留历史即可重试
        current.filter((m, i) => !(i === current.length - 1 && m.role === "assistant" && !m.content)),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  // 修改模式：拿回完整修改稿，先预览，应用交给父组件走 PATCH + 可撤销
  async function proposeEdit(instruction: string, activeAttachments: ChatAttachment[] = []) {
    const summary = instruction || (activeAttachments.length ? `根据上传的 ${activeAttachments.length} 个附件修改文章` : "修改文章");
    const userMessage: ChatMessage = {
      role: "user",
      content: summary,
      attachments: activeAttachments.length > 0 ? activeAttachments : undefined,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError("");
    setProposing(true);
    try {
      const response = await fetch(`/api/articles/${articleId}/ai-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: instruction || "请参考上传的附件内容对文章进行相应修改与补充",
          selection: quoted?.text ?? "",
          attachments: activeAttachments.map((att) => ({
            name: att.name,
            type: att.type,
            content: att.content,
            ref: att.ref,
            dataUrl: att.preview,
          })),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "AI 修改失败");
      setPendingEdit(data.content as string);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 修改失败");
    } finally {
      setProposing(false);
    }
  }

  async function applyEdit() {
    if (!pendingEdit) return;
    setApplying(true);
    setError("");
    try {
      await onApplyEdit(pendingEdit);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: "已把修改写入文章。可以在顶部工具栏用撤销按钮返回修改前。" },
      ]);
      setPendingEdit(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "应用修改失败");
    } finally {
      setApplying(false);
    }
  }

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !streaming && !proposing && !applying && !attaching;

  return (
    <aside
      className={`ai-assistant ${dragging ? "ai-assistant-drop-active" : ""}`}
      aria-label="AI 助手与整理"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const droppedFiles = Array.from(e.dataTransfer.files || []);
        if (droppedFiles.length > 0) {
          void handleFiles(droppedFiles);
        }
      }}
      onPaste={handlePaste}
    >
      <div className="reader-panel-header">
        <h2>
          <BotMessageSquare aria-hidden="true" />
          AI 助手 · 整理与对话
        </h2>
        <button type="button" className="reader-panel-close" onClick={onClose} aria-label="关闭 AI 对话">
          <X aria-hidden="true" />
        </button>
      </div>

      {quoted?.text && (
        <div className="ai-selection">
          <p title={quoted.text}>{quoted.text}</p>
        </div>
      )}

      <div className="ai-messages" ref={listRef}>
        {messages.length === 0 && !pendingEdit && (
          <div className="ai-empty">
            <BotMessageSquare aria-hidden="true" />
            <p>可直接粘贴图片截图（Cmd+V）或拖入附件，让 AI 结合图片与文档回答，或直接改写、扩写与整理文章。</p>
          </div>
        )}
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div key={`u-${index}`} className="ai-message ai-message--user">
              {message.attachments && message.attachments.length > 0 && (
                <div className="ai-chat-turn-attachments">
                  {message.attachments.map((att) =>
                    att.type === "image" && att.preview ? (
                      <img
                        key={att.id}
                        src={att.preview}
                        alt={att.name}
                        title={att.name}
                        className="ai-chat-turn-img"
                      />
                    ) : (
                      <span key={att.id} className="ai-chat-turn-doc">
                        <FileText size={12} aria-hidden="true" />
                        <span>{att.name}</span>
                      </span>
                    ),
                  )}
                </div>
              )}
              <div className="ai-message-text">{message.content}</div>
            </div>
          ) : (
            <div
              key={`a-${index}`}
              className={`ai-message ai-message--assistant${
                streaming && index === messages.length - 1 && !message.content ? " ai-streaming" : ""
              }`}
            >
              {message.content ? (
                <AnswerBody content={message.content} />
              ) : (
                <span className="ai-placeholder">正在思考…</span>
              )}
            </div>
          ),
        )}
        {pendingEdit !== null && (
          <div className="ai-edit-card" data-pending>
            <div className="ai-edit-card-head">
              <span>
                <PenLine aria-hidden="true" /> AI 修改稿
              </span>
              <div className="ai-edit-card-actions">
                <button type="button" className="ai-edit-discard" onClick={() => setPendingEdit(null)} disabled={applying}>
                  放弃
                </button>
                <button type="button" className="ai-edit-apply" onClick={() => void applyEdit()} disabled={applying}>
                  {applying ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}
                  {applying ? "应用中…" : "应用到文章"}
                </button>
              </div>
            </div>
            <pre>{pendingEdit}</pre>
          </div>
        )}
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="ai-composer">
        <div className="ai-mode-toggle" role="group" aria-label="对话模式">
          <button
            type="button"
            className={mode === "ask" ? "is-active" : ""}
            onClick={() => setMode("ask")}
            disabled={streaming || proposing}
          >
            问答
          </button>
          <button
            type="button"
            className={mode === "edit" ? "is-active" : ""}
            onClick={() => setMode("edit")}
            disabled={streaming || proposing}
          >
            修改与整理文章
          </button>
        </div>

        <form
          className="ai-chat-box"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          {/* 附件展示条 */}
          {(attachments.length > 0 || attaching) && (
            <div className="ai-chat-attach-bar">
              {attaching && (
                <span className="ai-chat-attach-pending">
                  <Loader2 size={13} className="ai-spinner" aria-hidden="true" />
                  <span>附件处理中…</span>
                </span>
              )}
              {attachments.map((att) => (
                <span key={att.id} className="ai-chat-attach-chip">
                  {att.type === "image" && att.preview ? (
                    <img src={att.preview} alt={att.name} />
                  ) : (
                    <FileText size={13} aria-hidden="true" />
                  )}
                  <span className="ai-chat-attach-name" title={att.name}>
                    {att.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除附件 ${att.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== att.id))}
                    disabled={streaming || proposing || applying}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            className="ai-chat-textarea"
            value={input}
            rows={2}
            placeholder={
              mode === "ask"
                ? quoted?.text
                  ? "针对引用的原文提问，支持直接粘贴图片/截图 (Cmd+V)…"
                  : "问这篇文章相关问题，支持直接粘贴图片/截图 (Cmd+V)…"
                : "说明如何修改，支持直接粘贴图片/截图 (Cmd+V)…"
            }
            onChange={(event) => setInput(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
          />

          <div className="ai-chat-bottom-bar">
            <div className="ai-chat-left-actions">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.md,.txt,.json,.csv,.pdf,text/*"
                className="sr-only"
                aria-label="上传附件"
                onChange={(e) => {
                  void handleFiles(Array.from(e.target.files || []));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="ai-chat-tool-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming || proposing || applying || attaching || attachments.length >= 4}
                title="上传图片或文档附件（辅助修改或问答）"
                aria-label="上传附件"
              >
                {attaching ? (
                  <Loader2 size={15} className="ai-spinner" aria-hidden="true" />
                ) : (
                  <Paperclip size={15} aria-hidden="true" />
                )}
              </button>
            </div>

            <button type="submit" className="ai-chat-submit-btn" disabled={!canSend} aria-label="发送">
              {streaming || proposing ? (
                <Loader2 size={14} className="ai-spinner" aria-hidden="true" />
              ) : mode === "edit" ? (
                <PenLine size={14} aria-hidden="true" />
              ) : (
                <ArrowUp size={14} aria-hidden="true" />
              )}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}

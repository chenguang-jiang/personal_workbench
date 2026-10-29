"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BotMessageSquare,
  Check,
  Loader2,
  PenLine,
  X,
} from "lucide-react";
import { renderMiniMarkdown } from "@/lib/mini-markdown";

export type AiChatSelection = { text: string; context: string } | null;

type ChatMessage = { role: "user" | "assistant"; content: string };

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
    const question = text.trim();
    if (!question || streaming || proposing || applying) return;
    if (mode === "edit") {
      await proposeEdit(question);
      return;
    }
    const history = [
      ...messages,
      {
        role: "user" as const,
        content: quoted?.text ? `关于这段原文：「${quoted.text.slice(0, 300)}」\n\n${question}` : question,
      },
    ];
    setMessages(history);
    setInput("");
    setError("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let answer = "";
    setMessages([...history, { role: "assistant", content: "" }]);
    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          articleTitle,
          articleContent,
          selection: quoted?.text ?? "",
          history,
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
  async function proposeEdit(instruction: string) {
    setMessages((current) => [...current, { role: "user", content: instruction }]);
    setInput("");
    setError("");
    setProposing(true);
    try {
      const response = await fetch(`/api/articles/${articleId}/ai-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, selection: quoted?.text ?? "" }),
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

  const canSend = input.trim().length > 0 && !streaming && !proposing && !applying;

  return (
    <aside className="ai-assistant" aria-label="AI 对话">
      <div className="reader-panel-header">
        <h2>
          <BotMessageSquare aria-hidden="true" />
          AI 对话 · 引用本文
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
            <p>围绕这篇文章提问，或切到「修改」让 AI 直接改写文章内容。</p>
          </div>
        )}
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div key={`u-${index}`} className="ai-message ai-message--user">
              {message.content}
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
            修改文章
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <textarea
            className="textarea ai-input"
            value={input}
            rows={2}
            placeholder={
              mode === "ask"
                ? quoted?.text
                  ? "针对引用的原文提问…"
                  : "问这篇文章相关的问题…"
                : "说明要怎么改，例如：把开头两段合并成一段，语气更直接…"
            }
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
          />
          <button type="submit" className="button ai-send" disabled={!canSend} aria-label="发送">
            {streaming || proposing ? (
              <Loader2 className="ai-spinner" aria-hidden="true" />
            ) : mode === "edit" ? (
              <PenLine aria-hidden="true" />
            ) : (
              <ArrowUp aria-hidden="true" />
            )}
          </button>
        </form>
      </div>
    </aside>
  );
}

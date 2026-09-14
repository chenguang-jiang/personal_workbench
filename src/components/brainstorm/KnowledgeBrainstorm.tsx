"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  FileText,
  Folder,
  Library,
  Loader2,
  MessageSquareText,
  PanelLeftClose,
  Plus,
  Quote,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { renderMiniMarkdown } from "@/lib/mini-markdown";
import { useRouter } from "next/navigation";
import { createDawnHandoff } from "@/lib/dawn-agent-handoff-client";

type ChatTurn = { role: "user" | "assistant"; content: string };
type Citation = {
  id: string;
  articleId: string;
  path: string;
  title: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  score: number;
  messageIndex: number;
};
type KnowledgeSession = {
  id: string;
  question: string;
  title?: string | null;
  mode: "knowledge";
  status: string;
  knowledgeSpaceId: string | null;
  groundingPolicy: "strict" | "assisted";
  messages: ChatTurn[];
  citations: Citation[];
  increments: number;
  updatedAt: string;
};
type SessionSummary = Pick<
  KnowledgeSession,
  | "id"
  | "question"
  | "title"
  | "mode"
  | "status"
  | "knowledgeSpaceId"
  | "groundingPolicy"
  | "increments"
  | "updatedAt"
>;
type Scope = {
  type: "vault" | "selection";
  folders: string[];
  articleIds: string[];
};
type Space = {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  scope: Scope;
  _count?: { brainstormSessions: number };
};
type ArticleOption = { articleId: string; title: string };
type FolderOption = { path: string; name: string };

function answerHtml(value: string) {
  return renderMiniMarkdown(value).replace(
    /\[(S\d+)\]/g,
    '<button type="button" class="kb-citation" data-citation="$1">[$1]</button>',
  );
}

function citationHref(sessionId: string, citation: Citation) {
  const params = new URLSearchParams({
    citationSession: sessionId,
    citationId: citation.id,
    messageIndex: String(citation.messageIndex),
  });
  return `/reading/${citation.articleId}?${params.toString()}`;
}

function formatCitationExcerpt(value: string) {
  const cleaned = value
    .replace(/```[^\n]*\n?/g, "")
    .split("\n")
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return "";
      if (/^\|?\s*:?-{3,}/.test(line)) return "";

      const withoutMarkdown = line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/^\[![^\]]+\]\s*/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1");

      if (/^\|.*\|$/.test(withoutMarkdown)) {
        const cells = withoutMarkdown
          .split("|")
          .map((cell) => cell.trim())
          .filter(Boolean);
        if (cells.length === 0) return "";
        const isHeader = cells.some((cell) =>
          ["参数名", "项目", "字段", "返回参数"].includes(cell),
        );
        return `${isHeader ? "" : "• "}${cells.join(" · ")}`;
      }

      return withoutMarkdown.replace(/^[-*•]\s+/, "• ");
    });

  return cleaned
    .filter((line, index) => line || (index > 0 && cleaned[index - 1]))
    .join("\n")
    .trim();
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function KnowledgeBrainstorm() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<KnowledgeSession | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [question, setQuestion] = useState("");
  const [composer, setComposer] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [policy, setPolicy] = useState<"strict" | "assisted">("strict");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sourceOpen, setSourceOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [spaceDialog, setSpaceDialog] = useState(false);
  const [spaceName, setSpaceName] = useState("");
  const [scopeType, setScopeType] = useState<"vault" | "selection">(
    "selection",
  );
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [articles, setArticles] = useState<ArticleOption[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [selectedArticles, setSelectedArticles] = useState<string[]>([]);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const selectedSpace = useMemo(
    () =>
      spaces.find(
        (item) => item.id === (session?.knowledgeSpaceId ?? spaceId),
      ) ?? null,
    [session?.knowledgeSpaceId, spaceId, spaces],
  );

  const loadSpaces = useCallback(async () => {
    const response = await fetch("/api/knowledge-spaces", {
      cache: "no-store",
    });
    const data = await response.json();
    const next = Array.isArray(data.spaces) ? data.spaces : [];
    setSpaces(next);
    setSpaceId(
      (current) =>
        current ||
        next.find((item: Space) => item.isDefault)?.id ||
        next[0]?.id ||
        "",
    );
  }, []);

  const loadSessions = useCallback(async () => {
    const response = await fetch("/api/brainstorm", { cache: "no-store" });
    const data = await response.json();
    setSessions(
      (Array.isArray(data.sessions) ? data.sessions : []).filter(
        (item: SessionSummary) => item.mode === "knowledge",
      ),
    );
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setCitation(null);
    const response = await fetch(`/api/brainstorm/${id}`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "会话加载失败");
    setSession(data);
    setPolicy(data.groundingPolicy === "assisted" ? "assisted" : "strict");
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      if (window.matchMedia("(max-width: 960px)").matches) {
        setSourceOpen(false);
        setInspectorOpen(false);
      } else if (window.matchMedia("(max-width: 1500px)").matches) {
        setInspectorOpen(false);
      }
      void Promise.all([loadSpaces(), loadSessions()]).catch(() =>
        setNotice("知识库模式加载失败"),
      );
      fetch("/api/obsidian/library?mode=folders")
        .then((response) => response.json())
        .then((data) =>
          setFolders(Array.isArray(data.folders) ? data.folders : []),
        )
        .catch(() => setFolders([]));
      fetch("/api/knowledge?sort=recent")
        .then((response) => response.json())
        .then((data) =>
          setArticles(
            (Array.isArray(data) ? data : [])
              .filter((item: { articleId?: string }) => Boolean(item.articleId))
              .map((item: { articleId: string; title: string }) => ({
                articleId: item.articleId,
                title: item.title,
              })),
          ),
        )
        .catch(() => setArticles([]));
    });
  }, [loadSessions, loadSpaces]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages.length]);

  async function start() {
    const text = question.trim();
    if (!text || !spaceId || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/brainstorm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          mode: "knowledge",
          knowledgeSpaceId: spaceId,
          groundingPolicy: policy,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "会话创建失败");
      await loadSession(data.id);
      await loadSessions();
      setQuestion("");
      // 自动发送问题内容作为第一条消息，无需用户再次输入
      await sendInternal(text);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "会话创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendInternal(content: string) {
    if (!content || !session) return;
    setSession((current) =>
      current
        ? { ...current, messages: [...current.messages, { role: "user", content }] }
        : current,
    );
    try {
      const response = await fetch(
        `/api/brainstorm/${session.id}/knowledge-message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "message", content }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "回答失败");
      setSession((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                { role: "assistant", content: data.answer },
              ],
              citations: [...current.citations, ...(data.citations ?? [])],
              title: data.title ?? current.title,
            }
          : current,
      );
      void loadSessions();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "回答失败");
      await loadSession(session.id).catch(() => {});
    }
  }

  async function send() {
    const content = composer.trim();
    if (!content || !session || busy) return;
    setBusy(true);
    setComposer("");
    setNotice("");
    await sendInternal(content);
    setBusy(false);
  }

  async function changePolicy(next: "strict" | "assisted") {
    setPolicy(next);
    if (!session) return;
    const response = await fetch(`/api/brainstorm/${session.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "grounding-policy",
        groundingPolicy: next,
      }),
    });
    if (response.ok)
      setSession((current) =>
        current ? { ...current, groundingPolicy: next } : current,
      );
  }

  async function createSpace() {
    if (!spaceName.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/knowledge-spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: spaceName.trim(),
          scope: {
            type: scopeType,
            folders: scopeType === "selection" ? selectedFolders : [],
            articleIds: scopeType === "selection" ? selectedArticles : [],
          },
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Knowledge Space 创建失败");
      await loadSpaces();
      setSpaceId(data.id);
      setSpaceDialog(false);
      setSpaceName("");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Knowledge Space 创建失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function action(
    name: "save-note" | "proposition" | "to-reasoning",
    assistantContent: string,
  ) {
    if (!session) return;
    setNotice("");
    const response = await fetch(
      `/api/brainstorm/${session.id}/knowledge-message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: name,
          assistantContent,
          content: assistantContent.replace(/\[(?:S\d+)\]/g, "").slice(0, 400),
        }),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      setNotice(data.error || "操作失败");
      return;
    }
    if (name === "save-note") setNotice(`已保存到 Obsidian：${data.path}`);
    if (name === "proposition") setNotice("已加入当前会话的命题台账");
    if (name === "to-reasoning") {
      router.push(`/brainstorm?mode=reasoning&session=${data.id}`);
    }
  }

  async function handoffToDawn(answer: string, messageIndex: number) {
    if (!session) return;
    setBusy(true);
    setNotice("");
    try {
      const evidence = session.citations
        .filter((item) => item.messageIndex === messageIndex)
        .map((item) => `[${item.id}] ${item.path}\n${item.quote}`)
        .join("\n\n");
      const handoff = await createDawnHandoff({
        sourceType: "knowledge",
        sourceTitle: session.question,
        sourceRef: session.id,
        selectedText: answer,
        context: evidence,
        instruction:
          "请先核对这些知识库结论与目标项目的真实代码，再把结论转化为可验证的实现任务；涉及修改时给出计划并走审批。",
        metadata: {
          knowledgeSpaceId: session.knowledgeSpaceId,
          groundingPolicy: session.groundingPolicy,
        },
      });
      router.push(`/dawn-agent?handoff=${handoff.id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法交给 Dawn Agent");
      setBusy(false);
    }
  }

  function pickCitation(id: string, messageIndex: number) {
    const found = session?.citations.find(
      (item) => item.id === id && item.messageIndex === messageIndex,
    );
    if (!found) return;
    setCitation(found);
    if (window.matchMedia("(max-width: 960px)").matches) setSourceOpen(false);
    setInspectorOpen(true);
  }

  function openSources() {
    if (window.matchMedia("(max-width: 960px)").matches)
      setInspectorOpen(false);
    setSourceOpen(true);
  }

  function newSession() {
    setSession(null);
    setCitation(null);
    setQuestion("");
    setComposer("");
    if (window.matchMedia("(max-width: 760px)").matches) setSourceOpen(false);
  }

  async function selectSession(id: string) {
    await loadSession(id);
    if (window.matchMedia("(max-width: 760px)").matches) setSourceOpen(false);
  }

  async function deleteSession(item: SessionSummary) {
    if (
      !window.confirm(
        `删除询问记录「${item.title || item.question}」？该操作不可恢复。`,
      )
    )
      return;
    const response = await fetch(`/api/brainstorm/${item.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setNotice("删除失败，请稍后重试");
      return;
    }
    setSessions((current) => current.filter((entry) => entry.id !== item.id));
    if (session?.id === item.id) {
      setSession(null);
      setCitation(null);
    }
  }

  async function reindex() {
    setBusy(true);
    setNotice("正在重建知识片段索引…");
    const response = await fetch("/api/knowledge/reindex", { method: "POST" });
    const data = await response.json();
    setNotice(
      response.ok
        ? `索引已更新：${data.articles} 篇文档，${data.chunks} 个片段`
        : data.error,
    );
    setBusy(false);
  }

  return (
    <main className="page-frame page-frame--wide kb-mode-page brainstorm-page brainstorm-page--knowledge">
      <PageHeader
        eyebrow="SOURCE-GROUNDED BRAINSTORM"
        title="知识库模式"
        description="只在你选定的 Obsidian 来源中检索、回答并给出可回到原文的引用。"
        actions={
          <>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void reindex()}
              disabled={busy}
            >
              <RefreshCw className={busy ? "spin" : ""} /> 更新索引
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => setSpaceDialog(true)}
            >
              <Plus /> Knowledge Space
            </button>
          </>
        }
      />
      {notice && (
        <div className="kb-notice">
          {notice}
          <button type="button" onClick={() => setNotice("")}>
            <X />
          </button>
        </div>
      )}

      <section
        className={`kb-workspace ${!sourceOpen ? "kb-workspace--sources-closed" : ""} ${inspectorOpen ? "kb-workspace--inspector-open" : ""} ${citation ? "kb-workspace--citation-active" : ""}`}
      >
        <aside className="kb-sources">
          <header>
            <div>
              <span>HISTORY</span>
              <h2>询问记录</h2>
            </div>
            <button
              type="button"
              onClick={() => setSourceOpen(false)}
              aria-label="收起询问记录"
            >
              <PanelLeftClose />
            </button>
          </header>
          <div className="kb-history-toolbar">
            <button type="button" onClick={newSession}>
              <Plus />
              <span>新建询问</span>
            </button>
          </div>
          <section className="kb-history-section" aria-label="最近询问">
            <div className="kb-history-label">
              <span>最近</span>
              <small>{sessions.length}</small>
            </div>
            <div className="kb-history-list">
              {sessions.length === 0 ? (
                <p>还没有询问记录，从一个问题开始吧。</p>
              ) : (
                sessions.map((item) => (
                  <div
                    key={item.id}
                    className={`kb-history-item ${item.id === session?.id ? "is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="kb-history-open"
                      onClick={() => void selectSession(item.id)}
                      aria-current={item.id === session?.id ? "page" : undefined}
                      title={item.question}
                    >
                      <span className="kb-history-icon">
                        <MessageSquareText />
                      </span>
                      <span>
                        <strong>{item.title || item.question}</strong>
                        <small>
                          {formatSessionTime(item.updatedAt)} · {item.status === "done" ? "已完成" : "进行中"}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="kb-history-delete"
                      aria-label={`删除「${item.title || item.question}」`}
                      title="删除该记录"
                      onClick={() => void deleteSession(item)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>

        {!sourceOpen && (
          <button
            className="kb-source-reopen"
            type="button"
            onClick={openSources}
          >
            <ChevronRight />
            会话
          </button>
        )}

        <section className="kb-conversation">
          <div className="kb-thread" ref={threadRef}>
            {!session ? (
              <div className="kb-start">
                <span>
                  <BookOpen />
                </span>
                <p className="micro-label">ASK YOUR SOURCES</p>
                <h2>从你的知识库开始，而不是从模型猜测开始</h2>
                <p>
                  选择来源空间，提出一个需要综合多篇笔记的问题。会话创建后模式固定，但来源策略仍可调整。
                </p>
                <div className="kb-start-composer">
                  <div className="kb-start-prompt-meta">
                    <label htmlFor="kb-research-question">研究问题</label>
                    <span>⌘/Ctrl + Enter 开始</span>
                  </div>
                  <textarea
                    id="kb-research-question"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        event.preventDefault();
                        void start();
                      }
                    }}
                    rows={4}
                    placeholder="例如：我的知识库如何定义一个可靠的 Agent 权限边界？"
                  />
                  <div className="kb-start-controls">
                    <label className="kb-start-source">
                      <Library />
                      <span>检索范围</span>
                      <select
                        aria-label="检索范围"
                        value={spaceId}
                        onChange={(event) => setSpaceId(event.target.value)}
                      >
                        {spaces.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="kb-start-actions">
                      <div
                        className="kb-policy-toggle"
                        role="group"
                        aria-label="来源策略"
                      >
                        <button
                          type="button"
                          className={policy === "strict" ? "is-active" : ""}
                          onClick={() => setPolicy("strict")}
                        >
                          严格来源
                        </button>
                        <button
                          type="button"
                          className={policy === "assisted" ? "is-active" : ""}
                          onClick={() => setPolicy("assisted")}
                        >
                          来源 + 补充
                        </button>
                      </div>
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={() => void start()}
                        disabled={!question.trim() || !spaceId || busy}
                      >
                        {busy ? <Loader2 className="spin" /> : <ArrowRight />}
                        开始检索
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="kb-thread-heading">
                  <div>
                    <span>RESEARCH QUESTION</span>
                    <h2>{session.question}</h2>
                  </div>
                  <div className="kb-policy-toggle">
                    <button
                      type="button"
                      className={policy === "strict" ? "is-active" : ""}
                      onClick={() => void changePolicy("strict")}
                    >
                      严格来源
                    </button>
                    <button
                      type="button"
                      className={policy === "assisted" ? "is-active" : ""}
                      onClick={() => void changePolicy("assisted")}
                    >
                      来源 + 补充
                    </button>
                  </div>
                </div>
                {session.messages.length === 0 && (
                  <div className="kb-empty-thread">
                    <Sparkles />
                    <p>可以先问“请概括这些来源的共同观点与分歧”。</p>
                  </div>
                )}
                {session.messages.map((message, index) =>
                  message.role === "user" ? (
                    <article
                      key={index}
                      className="kb-message kb-message--user"
                    >
                      <p>{message.content}</p>
                    </article>
                  ) : (
                    <article
                      key={index}
                      className="kb-message kb-message--assistant"
                    >
                      <header>
                        <span>
                          <Sparkles />
                        </span>
                        <strong>Dawn Knowledge</strong>
                        <small>
                          {policy === "strict"
                            ? "仅基于来源"
                            : "来源与补充分区"}
                        </small>
                      </header>
                      <div
                        className="mini-markdown"
                        dangerouslySetInnerHTML={{
                          __html: answerHtml(message.content),
                        }}
                        onClick={(event) => {
                          const target = (
                            event.target as HTMLElement
                          ).closest<HTMLElement>("[data-citation]");
                          if (target?.dataset.citation)
                            pickCitation(target.dataset.citation, index);
                        }}
                      />
                      <footer>
                        <button
                          type="button"
                          onClick={() =>
                            void action("save-note", message.content)
                          }
                        >
                          <Save />
                          保存为笔记
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void action("proposition", message.content)
                          }
                        >
                          <Check />
                          转为命题
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void action("to-reasoning", message.content)
                          }
                        >
                          <BrainCircuit />
                          进入推理模式
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handoffToDawn(message.content, index)
                          }
                        >
                          <Bot />
                          交给 Dawn Agent
                        </button>
                      </footer>
                    </article>
                  ),
                )}
                {busy && (
                  <div className="kb-thinking">
                    <Loader2 />
                    <span>正在检索来源并组织带引用的回答…</span>
                  </div>
                )}
              </>
            )}
          </div>

          {session && (
            <div className="kb-composer">
              <div className="kb-composer-main">
                <textarea
                  aria-label="继续追问"
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  rows={2}
                  placeholder="继续追问，或要求比较来源之间的分歧…"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  className="button button-primary kb-composer-send"
                  type="button"
                  onClick={() => void send()}
                  disabled={!composer.trim() || busy}
                >
                  {busy ? <Loader2 className="spin" /> : <Send />}发送
                </button>
              </div>
              <div className="kb-composer-meta">
                <span>
                  <Quote />
                  {selectedSpace?.name} ·{" "}
                  {policy === "strict" ? "严格来源" : "来源 + 模型补充"}
                </span>
                <small>Enter 发送 · Shift + Enter 换行</small>
              </div>
            </div>
          )}
        </section>

        {inspectorOpen && (
          <aside className="kb-inspector">
            <header>
              <div>
                <span>CITATION</span>
                <h2>来源定位</h2>
              </div>
              <button
                type="button"
                onClick={() => setInspectorOpen(false)}
                aria-label="关闭来源定位"
              >
                <X />
              </button>
            </header>
            {citation ? (
              <div className="kb-citation-detail">
                <div className="kb-citation-content">
                  <span className="kb-citation-number">[{citation.id}]</span>
                  <h3>{citation.title}</h3>
                  <div className="kb-citation-meta">
                    <p className="kb-citation-path">{citation.path}</p>
                    <span>
                      字符 {citation.startOffset}–{citation.endOffset}
                    </span>
                  </div>
                  <section className="kb-citation-excerpt">
                    <h4>来源片段</h4>
                    <p>{formatCitationExcerpt(citation.quote)}</p>
                  </section>
                </div>
                <div className="kb-citation-actions">
                  <Link
                    href={citationHref(session!.id, citation)}
                    className="button button-primary"
                  >
                    <BookOpen />
                    打开原文
                  </Link>
                </div>
              </div>
            ) : (
              <div className="kb-inspector-empty">
                <Quote />
                <strong>证据工作台</strong>
                <p>
                  点击回答中的 [S1]
                  查看原文；已有引用也会留在这里，方便持续核对。
                </p>
                <div className="kb-inspector-summary">
                  <span>
                    <b>{session?.citations.length ?? 0}</b> 条引用
                  </span>
                  <span>
                    <b>
                      {selectedSpace?.scope.type === "vault"
                        ? "全库"
                        : (selectedSpace?.scope.folders.length ?? 0) +
                          (selectedSpace?.scope.articleIds.length ?? 0)}
                    </b>{" "}
                    来源范围
                  </span>
                </div>
                {(session?.citations.length ?? 0) > 0 && (
                  <div className="kb-inspector-evidence-list">
                    {session!.citations
                      .slice(-6)
                      .reverse()
                      .map((item, index) => (
                        <button
                          type="button"
                          key={`${item.messageIndex}-${item.id}-${index}`}
                          onClick={() => setCitation(item)}
                        >
                          <span>[{item.id}]</span>
                          <strong>{item.title}</strong>
                          <small>{item.quote}</small>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </section>

      {spaceDialog && (
        <div
          className="kb-dialog-layer"
          role="presentation"
          onMouseDown={() => setSpaceDialog(false)}
        >
          <section
            className="kb-space-dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="micro-label">NEW KNOWLEDGE SPACE</p>
                <h2>创建来源空间</h2>
              </div>
              <button type="button" onClick={() => setSpaceDialog(false)}>
                <X />
              </button>
            </header>
            <label>
              <span>名称</span>
              <input
                value={spaceName}
                onChange={(event) => setSpaceName(event.target.value)}
                placeholder="例如：Agent 工程与安全"
              />
            </label>
            <div className="kb-scope-type">
              <button
                type="button"
                className={scopeType === "vault" ? "is-active" : ""}
                onClick={() => setScopeType("vault")}
              >
                <Library />
                <span>
                  <strong>整个 Vault</strong>
                  <small>所有已同步文档</small>
                </span>
              </button>
              <button
                type="button"
                className={scopeType === "selection" ? "is-active" : ""}
                onClick={() => setScopeType("selection")}
              >
                <Settings2 />
                <span>
                  <strong>自定义来源</strong>
                  <small>文件夹与文档组合</small>
                </span>
              </button>
            </div>
            {scopeType === "selection" && (
              <div className="kb-source-picker">
                <section>
                  <h3>文件夹</h3>
                  {folders.slice(0, 80).map((folder) => (
                    <label key={folder.path}>
                      <input
                        type="checkbox"
                        checked={selectedFolders.includes(folder.path)}
                        onChange={() =>
                          setSelectedFolders((current) =>
                            current.includes(folder.path)
                              ? current.filter((item) => item !== folder.path)
                              : [...current, folder.path],
                          )
                        }
                      />
                      <Folder />
                      <span>{folder.path}</span>
                    </label>
                  ))}
                </section>
                <section>
                  <h3>单篇文档</h3>
                  {articles.slice(0, 100).map((article) => (
                    <label key={article.articleId}>
                      <input
                        type="checkbox"
                        checked={selectedArticles.includes(article.articleId)}
                        onChange={() =>
                          setSelectedArticles((current) =>
                            current.includes(article.articleId)
                              ? current.filter(
                                  (item) => item !== article.articleId,
                                )
                              : [...current, article.articleId],
                          )
                        }
                      />
                      <FileText />
                      <span>{article.title}</span>
                    </label>
                  ))}
                </section>
              </div>
            )}
            <footer>
              <span>
                {scopeType === "vault"
                  ? "将检索整个知识库"
                  : `已选 ${selectedFolders.length} 个文件夹、${selectedArticles.length} 篇文档`}
              </span>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void createSpace()}
                disabled={!spaceName.trim() || busy}
              >
                {busy ? <Loader2 className="spin" /> : <Plus />}创建
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

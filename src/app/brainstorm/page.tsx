"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileText,
  Flag,
  FolderOpen,
  HelpCircle,
  Loader2,
  Library,
  Pencil,
  Plus,
  Route as RouteIcon,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { renderMiniMarkdown } from "@/lib/mini-markdown";
import { useUiPrefs } from "@/lib/ui-prefs";
import { KnowledgeBrainstorm } from "@/components/brainstorm/KnowledgeBrainstorm";
import { createDawnHandoff } from "@/lib/dawn-agent-handoff-client";

type SessionSummary = {
  id: string;
  question: string;
  title?: string | null;
  mode?: "reasoning" | "knowledge";
  status: string;
  propositions: number;
  routes: number;
  summary?: string | null;
  increments: number;
  createdAt: string;
  updatedAt: string;
};

type ChatTurn = { role: "user" | "assistant"; content: string };
type Route = { id: string; text: string; status: string };
type Proposition = {
  id: string;
  text: string;
  status: string;
  boundary?: string;
  decision?: string;
};

type Reference = {
  id: string;
  type: "article" | "folder";
  title: string;
  articleId?: string;
  path?: string;
};

type IncrementEntry = { title: string; path: string; at: string };

type DecisionEntry = {
  id: string;
  choice: string;
  label: string;
  q: string;
  at: string;
};

type OptionItem = { key: string; label: string; raw: string };

// 从 AI 回复里提取可操作的枚举条目：**角度 1：…** / 情况 A：… / 1. …，供一键入台账/开子路线/选择
function extractOptions(text: string): OptionItem[] {
  const found: OptionItem[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string, raw: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const clean = label
      .replace(/\*{1,2}/g, "")
      .replace(/[“”"']/g, "")
      .split(/——|（|\(|；|;/)[0]
      .trim()
      .slice(0, 42);
    found.push({ key, label: clean || key, raw });
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.length > 600) continue;
    let m = line.match(
      /^(?:\*{1,2})?角度\s*(\d{1,2})\s*[:：.、)"“]?\s*(?:\*{1,2})?\s*(.*?)\*{0,2}$/,
    );
    if (m) {
      push(`角度 ${m[1]}`, m[2], line);
      continue;
    }
    m = line.match(
      /^(?:\*{1,2})?(?:情况|方案|选项|路径|选择)\s*([A-Z])\s*[:：．.)、]\s*(?:\*{1,2})?\s*(.+)$/,
    );
    if (m) {
      push(m[1], m[2], line);
      continue;
    }
    m = line.match(/^(?:\*{1,2})?([A-Z])[.:：]\s*(?:\*{1,2})?\s*(.+)$/);
    if (m) {
      push(m[1], m[2], line);
      continue;
    }
    m = line.match(/^(?:[-*]\s*)?(\d{1,2})[.、)]\s*(.+)$/);
    if (m) {
      push(m[1], m[2], line);
      continue;
    }
  }
  if (found.length < 2 || found.length > 5) return [];
  const family = (key: string) =>
    /^角度/.test(key) ? "a" : /^[A-Z]$/.test(key) ? "b" : "c";
  if (new Set(found.map((item) => family(item.key))).size > 1) return [];
  const nums = found.map((item) => {
    const core = item.key.replace("角度 ", "");
    return /^[A-Z]$/.test(core)
      ? core.charCodeAt(0) - 65
      : parseInt(core, 10) - 1;
  });
  for (let i = 1; i < nums.length; i++)
    if (nums[i] !== nums[i - 1] + 1) return [];
  return found;
}

type Session = SessionSummary & {
  incrementLog?: IncrementEntry[];
  decisions?: DecisionEntry[];
  propositions: Proposition[];
  routes: Route[];
  references: Reference[];
  messages: ChatTurn[];
};

const ROUTE_ORDER = ["open", "exploring", "completed", "supported-with-gaps"];

function NoteLine({
  label,
  value,
  placeholder,
  onSave,
  disabled,
}: {
  label: string;
  value?: string;
  placeholder: string;
  onSave: (text: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (editing) {
    return (
      <div className="bs-note-edit">
        <textarea
          className="textarea"
          rows={2}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="bs-note-edit-actions">
          <button
            type="button"
            className="bs-mini-btn"
            onClick={() => {
              onSave(draft.trim());
              setEditing(false);
            }}
          >
            保存
          </button>
          <button
            type="button"
            className="bs-mini-btn"
            onClick={() => setEditing(false)}
          >
            取消
          </button>
        </div>
      </div>
    );
  }
  return (
    <p className="bs-note">
      <span>{label}</span>
      {value || <em>{placeholder}</em>}
      {!disabled && (
        <button
          type="button"
          aria-label={`编辑${label}`}
          onClick={() => {
            setDraft(value ?? "");
            setEditing(true);
          }}
        >
          <Pencil aria-hidden="true" />
        </button>
      )}
    </p>
  );
}

function ReasoningBrainstormPage() {
  const router = useRouter();
  const { t } = useUiPrefs();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState("");
  const [composer, setComposer] = useState("");
  const [routeDraft, setRouteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState("");
  const [aiStatus, setAiStatus] = useState<{
    detail: string;
    available: boolean;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<"article" | "folder">("article");
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerArticles, setPickerArticles] = useState<
    { articleId: string; title: string }[]
  >([]);
  const [pickerFolders, setPickerFolders] = useState<
    { path: string; name: string }[]
  >([]);
  const [pendingRefs, setPendingRefs] = useState<Reference[]>([]);
  const [revise, setRevise] = useState<{
    articleId: string;
    title: string;
    proposed: string;
  } | null>(null);
  const [reviseBusy, setReviseBusy] = useState(false);
  const [integrateOriginal, setIntegrateOriginal] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch("/api/brainstorm");
      const data = await response.json();
      setSessions(
        (Array.isArray(data.sessions) ? data.sessions : []).filter(
          (item: SessionSummary) => item.mode !== "knowledge",
        ),
      );
    } catch {
      setSessions([]);
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const response = await fetch(`/api/brainstorm/${id}`);
    if (!response.ok) throw new Error("会话加载失败");
    const data = (await response.json()) as Session;
    setSession(data);
    return data;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 首屏异步加载持久化会话
    void loadSessions();
    const requestedSession = new URLSearchParams(window.location.search).get(
      "session",
    );
    if (requestedSession) void loadSession(requestedSession).catch(() => {});
    fetch("/api/ai/status")
      .then((response) => response.json())
      .then((data) =>
        setAiStatus({
          detail: String(data.detail ?? ""),
          available: Boolean(data.available),
        }),
      )
      .catch(() => setAiStatus({ detail: "AI 未连接", available: false }));
  }, [loadSession, loadSessions]);

  useEffect(() => {
    if (!pickerOpen) return;
    if (pickerArticles.length === 0) {
      fetch("/api/knowledge?sort=recent")
        .then((response) => response.json())
        .then((nodes) =>
          setPickerArticles(
            (Array.isArray(nodes) ? nodes : [])
              .filter((node: { articleId?: string }) => Boolean(node.articleId))
              .map((node: { articleId: string; title: string }) => ({
                articleId: node.articleId,
                title: node.title,
              })),
          ),
        )
        .catch(() => setPickerArticles([]));
    }
    if (pickerFolders.length === 0) {
      fetch("/api/obsidian/library?mode=folders")
        .then((response) => response.json())
        .then((data) =>
          setPickerFolders(
            (Array.isArray(data.folders) ? data.folders : []).map(
              (folder: { path: string; name: string }) => ({
                path: folder.path,
                name: folder.name,
              }),
            ),
          ),
        )
        .catch(() => setPickerFolders([]));
    }
  }, [pickerOpen, pickerArticles.length, pickerFolders.length]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages]);

  async function send(
    content: string,
    target?: Session | null,
    decision?: { choice: string; label: string; q: string },
  ) {
    const current = target ?? session;
    const text = content.trim();
    if (!text || !current || busy) return;
    setBusy(true);
    setNotice("");
    setSession((prev) =>
      prev
        ? {
            ...prev,
            messages: [...prev.messages, { role: "user", content: text }],
            decisions: decision
              ? [
                  ...(prev.decisions ?? []),
                  {
                    id: `D-${(prev.decisions?.length ?? 0) + 1}`,
                    ...decision,
                    at: new Date().toISOString(),
                  },
                ]
              : prev.decisions,
          }
        : prev,
    );
    try {
      const response = await fetch(`/api/brainstorm/${current.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", content: text, decision }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `推演失败 (${response.status})`);
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("AI 未返回内容");
      setSession((prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, { role: "assistant", content: "" }],
            }
          : prev,
      );
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setSession((prev) => {
          if (!prev) return prev;
          const messages = [...prev.messages];
          const last = messages[messages.length - 1];
          messages[messages.length - 1] = {
            role: "assistant",
            content: last.content + chunk,
          };
          return { ...prev, messages };
        });
      }
      void loadSessions();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "推演失败");
      setSession((prev) => {
        if (!prev) return prev;
        const messages = [...prev.messages];
        if (
          messages.length &&
          messages[messages.length - 1].role === "assistant" &&
          !messages[messages.length - 1].content
        ) {
          messages.pop();
        }
        return { ...prev, messages };
      });
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const text = question.trim();
    if (!text || starting) return;
    setStarting(true);
    setNotice("");
    try {
      const response = await fetch("/api/brainstorm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建失败");
      setQuestion("");
      const fresh = await loadSession(data.id);
      await loadSessions();
      // 开始前挂载的参考资料，建会话后补挂上去
      if (pendingRefs.length > 0) {
        let refs = fresh.references ?? [];
        for (const ref of pendingRefs) {
          const response = await fetch(`/api/brainstorm/${data.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "ref-add", ref }),
          });
          const result = await response.json();
          if (response.ok) refs = result.references;
        }
        setPendingRefs([]);
        setSession((prev) => (prev ? { ...prev, references: refs } : prev));
      }
      await send(
        `请围绕这个问题开启头脑风暴：先帮我拆解问题，再给出 3 个最值得展开的推演角度。`,
        fresh,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建失败");
    } finally {
      setStarting(false);
    }
  }

  /** 通用动作请求，返回 data 或抛错 */
  async function act(body: Record<string, unknown>) {
    if (!session) return null;
    setNotice("");
    const response = await fetch(`/api/brainstorm/${session.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "操作失败");
    return data;
  }

  async function safeAct(body: Record<string, unknown>) {
    try {
      return await act(body);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
      return null;
    }
  }

  async function handoffToDawn(
    title: string,
    selectedText: string,
    instruction: string,
  ) {
    if (!session || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const accepted = session.propositions
        .filter((item) => item.status === "user-confirmed")
        .map(
          (item) =>
            `- ${item.text}${item.boundary ? `\n  边界：${item.boundary}` : ""}${item.decision ? `\n  决定：${item.decision}` : ""}`,
        )
        .join("\n");
      const references = session.references
        .map((item) => `- ${item.title}${item.path ? `（${item.path}）` : ""}`)
        .join("\n");
      const handoff = await createDawnHandoff({
        sourceType: "reasoning",
        sourceTitle: title,
        sourceRef: session.id,
        selectedText,
        context: [
          `原始问题：${session.question}`,
          references ? `参考资料：\n${references}` : "",
          accepted ? `已确认命题：\n${accepted}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        instruction,
        metadata: { brainstormSessionId: session.id },
      });
      router.push(`/dawn-agent?handoff=${handoff.id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法交给 Dawn Agent");
      setBusy(false);
    }
  }

  async function cycleRoute(route: Route) {
    const next =
      ROUTE_ORDER[(ROUTE_ORDER.indexOf(route.status) + 1) % ROUTE_ORDER.length];
    const data = await safeAct({
      action: "route-status",
      routeId: route.id,
      status: next,
    });
    if (data)
      setSession((prev) => (prev ? { ...prev, routes: data.routes } : prev));
  }

  async function cycleProp(prop: Proposition) {
    const order = ["pending", "user-confirmed", "revised"];
    const next = order[(order.indexOf(prop.status) + 1) % order.length];
    const data = await safeAct({
      action: "proposition-status",
      propId: prop.id,
      status: next,
    });
    if (data)
      setSession((prev) =>
        prev ? { ...prev, propositions: data.propositions } : prev,
      );
  }

  function makeRefId(
    type: "article" | "folder",
    ref: { articleId?: string; path?: string },
  ) {
    return type === "article" ? `a:${ref.articleId}` : `f:${ref.path}`;
  }

  async function attachRef(ref: Omit<Reference, "id">) {
    const withId: Reference = { ...ref, id: makeRefId(ref.type, ref) };
    if (!session) {
      setPendingRefs((current) =>
        current.some((item) => item.id === withId.id)
          ? current
          : [...current, withId],
      );
      setPickerOpen(false);
      return;
    }
    const data = await safeAct({ action: "ref-add", ref: withId });
    if (data)
      setSession((prev) =>
        prev ? { ...prev, references: data.references } : prev,
      );
    setPickerOpen(false);
  }

  async function removeRef(refId: string) {
    const data = await safeAct({ action: "ref-remove", refId });
    if (data)
      setSession((prev) =>
        prev ? { ...prev, references: data.references } : prev,
      );
  }

  const firstArticleRef = session?.references.find(
    (ref) => ref.type === "article",
  );

  async function openIncrement(path: string) {
    try {
      const response = await fetch(
        `/api/resolve?target=${encodeURIComponent(path)}`,
      );
      const data = await response.json();
      if (data?.id) {
        router.push(`/reading/${data.id}`);
        return;
      }
    } catch {
      // 解析失败回退书架搜索
    }
    const name = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    router.push(`/reading?search=${encodeURIComponent(name)}`);
  }

  async function openRevise(ref: Reference) {
    if (!session || ref.type !== "article") return;
    setReviseBusy(true);
    setNotice("");
    try {
      const data = await act({ action: "revise-reference", refId: ref.id });
      if (data)
        setRevise({
          articleId: data.articleId,
          title: data.title,
          proposed: data.proposed,
        });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI 修订失败");
    } finally {
      setReviseBusy(false);
    }
  }

  async function applyRevise() {
    if (!revise) return;
    setReviseBusy(true);
    try {
      const response = await fetch(`/api/articles/${revise.articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: revise.proposed }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `应用失败 (${response.status})`);
      }
      setNotice(`修订已应用到《${revise.title}》并同步 Obsidian`);
      setRevise(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "应用失败");
    } finally {
      setReviseBusy(false);
    }
  }

  async function removeSession(id: string) {
    await fetch(`/api/brainstorm/${id}`, { method: "DELETE" });
    if (session?.id === id) setSession(null);
    void loadSessions();
  }

  const done = session?.status === "done";
  const phase = !session ? "待开始" : done ? "已完成" : "推演中";
  const nextStep = !session
    ? "从一个问题开始"
    : done
      ? "暂无"
      : session.routes.length === 0
        ? "让 AI 规划探索路线，或直接在对话里推演"
        : session.propositions.length === 0
          ? "把值得验证的判断确认为命题"
          : "继续深挖，或把结论写回知识库";

  // 最后一条 AI 回复里的可点选选项（情况 A / 方案 B …）
  const lastAiOptions = useMemo(() => {
    const last = session?.messages[session.messages.length - 1];
    if (!last || last.role !== "assistant" || !last.content || busy || done)
      return [] as OptionItem[];
    return extractOptions(last.content);
  }, [session, busy, done]);

  return (
    <div className="page-frame page-frame--wide brainstorm-page brainstorm-page--reasoning">
      <PageHeader
        eyebrow="BRAINSTORM"
        title={t("nav_brainstorm")}
        description="从一个真实问题出发，与 AI 围绕你的知识库展开推演：拆解 → 探索路线 → 命题台账 → 写回知识增量。"
        actions={
          <span className="bs-header-actions">
            {aiStatus && (
              <span className="tag" title="当前 AI 后端">
                <span
                  className={
                    aiStatus.available
                      ? "status-dot"
                      : "status-dot status-dot--off"
                  }
                />
                {aiStatus.detail || "AI 未连接"}
              </span>
            )}
            <button
              type="button"
              className="bs-mini-btn"
              onClick={() => setGuideOpen(true)}
            >
              <HelpCircle aria-hidden="true" /> 怎么玩
            </button>
          </span>
        }
      />

      <section className="panel bs-start">
        <div className="bs-start-label">
          <button
            type="button"
            className="bs-plus"
            title="挂载参考资料：选择一篇文章或一个文件夹，推演时 AI 会把它当作事实底座，之后也可让 AI 修订这篇文章"
            aria-label="挂载参考资料"
            onClick={() => setPickerOpen(true)}
          >
            <Plus aria-hidden="true" />
          </button>
          <div>
            <p className="micro-label">START FROM A REAL QUESTION</p>
            <h2>你现在想推演什么？</h2>
          </div>
        </div>
        {pendingRefs.length > 0 && (
          <div className="bs-refs-row bs-refs-row--start">
            <span className="bs-refs-label">已挂载</span>
            {pendingRefs.map((ref) => (
              <span className="bs-ref-chip" key={ref.id} title={ref.title}>
                {ref.type === "article" ? (
                  <FileText aria-hidden="true" />
                ) : (
                  <FolderOpen aria-hidden="true" />
                )}
                <span className="bs-ref-chip-title">{ref.title}</span>
                <button
                  type="button"
                  aria-label="移除参考"
                  onClick={() =>
                    setPendingRefs((current) =>
                      current.filter((item) => item.id !== ref.id),
                    )
                  }
                >
                  <X aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          className="textarea bs-question"
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void start();
            }
          }}
          placeholder="丢一个你最近反复琢磨的问题，例如：怎样把散落的笔记，炼成能回答问题的知识网？"
        />
        <button
          type="button"
          className="button button-purple"
          onClick={() => void start()}
          disabled={starting || !question.trim()}
        >
          {starting ? (
            <Loader2 className="ai-spinner" aria-hidden="true" />
          ) : (
            <BrainCircuit aria-hidden="true" />
          )}{" "}
          开始头脑风暴
        </button>
      </section>

      <div className="bs-layout">
        <aside className="panel bs-history" aria-label="推演历史">
          <div className="bs-history-head">
            <p className="micro-label">SESSION HISTORY</p>
            <strong>{sessions.length} 次推演</strong>
          </div>
          {sessions.length === 0 ? (
            <p className="reader-panel-empty">
              还没有推演记录。从上面一个问题开始。
            </p>
          ) : (
            sessions.map((item) => (
              <div
                key={item.id}
                className={
                  session?.id === item.id
                    ? "bs-history-item active"
                    : "bs-history-item"
                }
              >
                <button
                  type="button"
                  className="bs-history-main"
                  onClick={() => void loadSession(item.id)}
                >
                  <div className="bs-history-top">
                    <span>{item.status === "done" ? "已完成" : "推演中"}</span>
                  </div>
                  <strong>{item.title || item.question}</strong>
                  {item.status === "done" && item.summary ? (
                    <small className="bs-history-summary">{item.summary}</small>
                  ) : null}
                  <small>
                    {new Date(item.updatedAt).toLocaleDateString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                    })}{" "}
                    · 路线 {item.routes} · 命题 {item.propositions} · 增量{" "}
                    {item.increments}
                  </small>
                </button>
                <button
                  type="button"
                  className="bs-history-delete"
                  aria-label={`删除会话 ${item.title || item.question}`}
                  onClick={() => void removeSession(item.id)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))
          )}
        </aside>

        <section className="panel bs-session" aria-label="推演会话">
          {!session ? (
            <div className="bs-empty">
              <BrainCircuit aria-hidden="true" />
              <p>选择左侧的历史会话，或从一个问题开始新的推演。</p>
              <button
                type="button"
                className="bs-mini-btn"
                onClick={() => setGuideOpen(true)}
              >
                <HelpCircle aria-hidden="true" /> 第一次玩？看看流程
              </button>
            </div>
          ) : (
            <>
              <p className="micro-label">SESSION STATE</p>
              <h2 className="bs-session-question">{session.question}</h2>
              <div className="bs-stats">
                <div>
                  <span>当前阶段</span>
                  <strong>{phase}</strong>
                </div>
                <div>
                  <span>探索路线</span>
                  <strong>{session.routes.length}</strong>
                </div>
                <div>
                  <span>命题台账</span>
                  <strong>{session.propositions.length}</strong>
                </div>
                <div>
                  <span>知识增量</span>
                  <strong>{session.increments}</strong>
                </div>
                <div>
                  <span>你的选择</span>
                  <strong>{session.decisions?.length ?? 0}</strong>
                </div>
              </div>
              <p className="bs-next-step">
                下一步只需回答：<strong>{nextStep}</strong>
              </p>

              <aside className="bs-session-board" aria-label="推演工作台">
                <section className="bs-refs-block" aria-label="参考资料">
                  <div className="bs-block-head">
                    <h3>
                      <FileText aria-hidden="true" /> 参考资料
                    </h3>
                    <button
                      type="button"
                      className="bs-mini-btn"
                      onClick={() => setPickerOpen(true)}
                      disabled={done}
                    >
                      <Plus aria-hidden="true" /> 挂载
                    </button>
                  </div>
                  {session.references.length === 0 ? (
                    <p className="bs-block-empty">
                      未挂载参考。点「+」选择一篇文章或文件夹：推演时 AI
                      以它为事实底座，之后还能让 AI 直接修订这篇文章。
                    </p>
                  ) : (
                    <div className="bs-refs-row">
                      {session.references.map((ref) => (
                        <span
                          className="bs-ref-chip"
                          key={ref.id}
                          title={ref.title}
                        >
                          {ref.type === "article" ? (
                            <FileText aria-hidden="true" />
                          ) : (
                            <FolderOpen aria-hidden="true" />
                          )}
                          <span className="bs-ref-chip-title">{ref.title}</span>
                          {ref.type === "article" && ref.articleId && (
                            <Link
                              href={`/reading/${ref.articleId}`}
                              className="bs-ref-action"
                              title="打开文章"
                              aria-label="打开文章"
                            >
                              <ExternalLink aria-hidden="true" />
                            </Link>
                          )}
                          {ref.type === "article" && (
                            <button
                              type="button"
                              className="bs-ref-action"
                              title="结合讨论让 AI 修订这篇文章"
                              aria-label="AI 修订文章"
                              disabled={done || reviseBusy}
                              onClick={() => void openRevise(ref)}
                            >
                              <Wand2 aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="bs-ref-action"
                            aria-label="移除参考"
                            disabled={done}
                            onClick={() => void removeRef(ref.id)}
                          >
                            <X aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </section>

                <section className="bs-block" aria-label="探索路线">
                  <div className="bs-block-head">
                    <h3>
                      <RouteIcon aria-hidden="true" /> 探索路线
                    </h3>
                    <div className="bs-block-actions">
                      <input
                        className="bs-route-input"
                        value={routeDraft}
                        placeholder="手动加一条路线…"
                        onChange={(event) => setRouteDraft(event.target.value)}
                        onKeyDown={async (event) => {
                          if (
                            event.key !== "Enter" ||
                            !routeDraft.trim() ||
                            done
                          )
                            return;
                          const data = await safeAct({
                            action: "route-add",
                            content: routeDraft.trim(),
                          });
                          if (data) {
                            setSession((prev) =>
                              prev ? { ...prev, routes: data.routes } : prev,
                            );
                            setRouteDraft("");
                          }
                        }}
                        disabled={done}
                      />
                      <button
                        type="button"
                        className="bs-mini-btn"
                        disabled={busy || done}
                        onClick={async () => {
                          setBusy(true);
                          const data = await safeAct({
                            action: "generate-routes",
                          });
                          if (data)
                            setSession((prev) =>
                              prev ? { ...prev, routes: data.routes } : prev,
                            );
                          setBusy(false);
                        }}
                      >
                        {busy ? (
                          <Loader2 className="ai-spinner" aria-hidden="true" />
                        ) : (
                          <Sparkles aria-hidden="true" />
                        )}{" "}
                        AI 规划
                      </button>
                    </div>
                  </div>
                  {session.routes.length === 0 ? (
                    <p className="bs-block-empty">
                      还没有探索路线。点「AI 规划」让 AI
                      基于当前讨论提出可验证的子问题。
                    </p>
                  ) : (
                    session.routes.map((route) => (
                      <div className="bs-route" key={route.id}>
                        <span className="bs-route-id">{route.id}</span>
                        <p className="bs-route-text">{route.text}</p>
                        <button
                          type="button"
                          className={`bs-chip bs-chip--${route.status}`}
                          title="点击切换状态"
                          disabled={done}
                          onClick={() => void cycleRoute(route)}
                        >
                          {route.status}
                        </button>
                        <button
                          type="button"
                          className="bs-card-delete"
                          aria-label="删除路线"
                          disabled={done}
                          onClick={async () => {
                            const data = await safeAct({
                              action: "route-remove",
                              routeId: route.id,
                            });
                            if (data)
                              setSession((prev) =>
                                prev ? { ...prev, routes: data.routes } : prev,
                              );
                          }}
                        >
                          <X aria-hidden="true" />
                        </button>
                      </div>
                    ))
                  )}
                </section>

                <section className="bs-block" aria-label="命题台账">
                  <div className="bs-block-head">
                    <h3>
                      <Zap aria-hidden="true" /> 命题台账
                    </h3>
                  </div>
                  {session.propositions.length === 0 ? (
                    <p className="bs-block-empty">
                      暂无命题。在 AI
                      回复上点「确认为命题」，把值得验证的判断记进台账。
                    </p>
                  ) : (
                    <div className="bs-props">
                      {session.propositions.map((prop) => (
                        <article className="bs-prop" key={prop.id}>
                          <div className="bs-prop-head">
                            <span className="bs-route-id">{prop.id}</span>
                            <button
                              type="button"
                              className={`bs-chip bs-chip--${prop.status}`}
                              title="点击切换：pending → user-confirmed → revised"
                              disabled={done}
                              onClick={() => void cycleProp(prop)}
                            >
                              {prop.status}
                            </button>
                            <button
                              type="button"
                              className="bs-card-delete"
                              aria-label="删除命题"
                              disabled={done}
                              onClick={async () => {
                                const data = await safeAct({
                                  action: "unproposition",
                                  propId: prop.id,
                                });
                                if (data)
                                  setSession((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          propositions: data.propositions,
                                        }
                                      : prev,
                                  );
                              }}
                            >
                              <X aria-hidden="true" />
                            </button>
                          </div>
                          <p className="bs-prop-text">{prop.text}</p>
                          <NoteLine
                            label="边界："
                            value={prop.boundary}
                            placeholder="点右侧铅笔手写，或用下方「AI 边界」。"
                            disabled={done}
                            onSave={async (text) => {
                              const data = await safeAct({
                                action: "proposition-note",
                                propId: prop.id,
                                field: "boundary",
                                content: text,
                              });
                              if (data)
                                setSession((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        propositions: data.propositions,
                                      }
                                    : prev,
                                );
                            }}
                          />
                          <NoteLine
                            label="你的决定："
                            value={prop.decision}
                            placeholder="待确认。"
                            disabled={done}
                            onSave={async (text) => {
                              const data = await safeAct({
                                action: "proposition-note",
                                propId: prop.id,
                                field: "decision",
                                content: text,
                              });
                              if (data)
                                setSession((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        propositions: data.propositions,
                                      }
                                    : prev,
                                );
                            }}
                          />
                          <div className="bs-prop-actions">
                            {prop.status !== "user-confirmed" && (
                              <button
                                type="button"
                                className="bs-mini-btn bs-mini-btn--accent"
                                disabled={done}
                                onClick={async () => {
                                  const data = await safeAct({
                                    action: "proposition-status",
                                    propId: prop.id,
                                    status: "user-confirmed",
                                  });
                                  if (data)
                                    setSession((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            propositions: data.propositions,
                                          }
                                        : prev,
                                    );
                                }}
                              >
                                <CheckCircle2 aria-hidden="true" /> 接受
                              </button>
                            )}
                            {prop.status !== "revised" && (
                              <button
                                type="button"
                                className="bs-mini-btn"
                                disabled={done}
                                onClick={async () => {
                                  const data = await safeAct({
                                    action: "proposition-status",
                                    propId: prop.id,
                                    status: "revised",
                                  });
                                  if (data)
                                    setSession((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            propositions: data.propositions,
                                          }
                                        : prev,
                                    );
                                }}
                              >
                                标记修订
                              </button>
                            )}
                            <button
                              type="button"
                              className="bs-mini-btn"
                              disabled={done || busy}
                              onClick={async () => {
                                setBusy(true);
                                const data = await safeAct({
                                  action: "proposition-boundary-ai",
                                  propId: prop.id,
                                });
                                if (data)
                                  setSession((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          propositions: data.propositions,
                                        }
                                      : prev,
                                  );
                                setBusy(false);
                              }}
                            >
                              <Sparkles aria-hidden="true" /> AI 边界
                            </button>
                            <button
                              type="button"
                              className="bs-mini-btn bs-mini-btn--accent"
                              disabled={busy}
                              onClick={() =>
                                void handoffToDawn(
                                  `${session.question} · ${prop.id}`,
                                  prop.text,
                                  "请把这条命题与目标项目的真实实现进行核对，并形成可以执行、测试和验收的改动方案。",
                                )
                              }
                            >
                              <Bot aria-hidden="true" /> 交给 Dawn
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </aside>

              <div className="bs-thread" ref={threadRef} aria-label="推演对话">
                {session.messages.map((turn, index) =>
                  turn.role === "user" ? (
                    <div className="ai-chat-msg ai-chat-msg--user" key={index}>
                      {turn.content}
                    </div>
                  ) : (
                    <div
                      className="ai-chat-msg ai-chat-msg--ai ai-prose bs-ai-msg"
                      key={index}
                    >
                      <div
                        dangerouslySetInnerHTML={{
                          __html: turn.content
                            ? renderMiniMarkdown(turn.content)
                            : "<p class='ai-thinking'>正在推演…</p>",
                        }}
                      />
                      {turn.content && !done && (
                        <div className="bs-ai-actions">
                          <button
                            type="button"
                            className="bs-confirm-prop"
                            disabled={busy}
                            onClick={async () => {
                              const text = turn.content
                                .replace(/[#*`>\n]/g, " ")
                                .trim()
                                .slice(0, 120);
                              const data = await safeAct({
                                action: "proposition",
                                content: text,
                              });
                              if (data)
                                setSession((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        propositions: data.propositions,
                                      }
                                    : prev,
                                );
                            }}
                          >
                            <Flag aria-hidden="true" /> 确认为命题
                          </button>
                          <button
                            type="button"
                            className="bs-confirm-prop"
                            disabled={busy}
                            onClick={() =>
                              void handoffToDawn(
                                session.question,
                                turn.content,
                                "请把这轮推演转化为目标项目中的具体实现任务；先验证项目现状，再给出计划并执行获批的修改。",
                              )
                            }
                          >
                            <Bot aria-hidden="true" /> 交给 Dawn Agent
                          </button>
                        </div>
                      )}
                      {index === session.messages.length - 1 &&
                        lastAiOptions.length > 0 && (
                          <div
                            className="bs-option-list"
                            role="group"
                            aria-label="对任意角度一键操作"
                          >
                            <span className="bs-option-hint">
                              不必按顺序回复——对任意角度直接操作：
                            </span>
                            {lastAiOptions.map((opt) => (
                              <div className="bs-option-row" key={opt.key}>
                                <span
                                  className="bs-option-label"
                                  title={opt.label}
                                >
                                  <em>{opt.key}</em>
                                  {opt.label}
                                </span>
                                <span className="bs-option-acts">
                                  <button
                                    type="button"
                                    className="bs-option-act"
                                    disabled={busy || done}
                                    title="把该角度记为命题，收进台账"
                                    onClick={async () => {
                                      const data = await safeAct({
                                        action: "proposition",
                                        content: opt.raw
                                          .replace(/\*{1,2}/g, "")
                                          .trim(),
                                      });
                                      if (data)
                                        setSession((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                propositions: data.propositions,
                                              }
                                            : prev,
                                        );
                                    }}
                                  >
                                    <Flag aria-hidden="true" /> 入台账
                                  </button>
                                  <button
                                    type="button"
                                    className="bs-option-act"
                                    disabled={busy || done}
                                    title="为该角度开一条子探索路线"
                                    onClick={async () => {
                                      const data = await safeAct({
                                        action: "route-add",
                                        content: opt.raw
                                          .replace(/\*{1,2}/g, "")
                                          .trim(),
                                      });
                                      if (data)
                                        setSession((prev) =>
                                          prev
                                            ? { ...prev, routes: data.routes }
                                            : prev,
                                        );
                                    }}
                                  >
                                    <RouteIcon aria-hidden="true" /> 子路线
                                  </button>
                                  <button
                                    type="button"
                                    className="bs-option-act bs-option-act--pick"
                                    disabled={busy || done}
                                    title="我支持这个角度：记录为我的选择并继续推演"
                                    onClick={() => {
                                      const q = (
                                        turn.content
                                          .split("\n")
                                          .find((line) => line.trim()) ?? ""
                                      )
                                        .replace(/[#*`>]/g, "")
                                        .trim()
                                        .slice(0, 80);
                                      void send(
                                        `我选择 ${opt.key}：${opt.label}`,
                                        session,
                                        {
                                          choice: opt.key,
                                          label: opt.label,
                                          q,
                                        },
                                      );
                                    }}
                                  >
                                    <CheckCircle2 aria-hidden="true" /> 我选它
                                  </button>
                                </span>
                              </div>
                            ))}
                            <span className="bs-option-hint">
                              或在下方输入框写自己的意见
                            </span>
                          </div>
                        )}
                    </div>
                  ),
                )}
              </div>

              <div className="ai-composer">
                <textarea
                  className="textarea"
                  rows={2}
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      const text = composer;
                      setComposer("");
                      void send(text);
                    }
                  }}
                  placeholder="继续推演：补充你的判断、追问或反例…（⌘↵ 发送）"
                  disabled={done}
                />
                <div className="ai-composer-actions">
                  <span className="annotation-ai-hint-inline">{notice}</span>
                  <div className="bs-actions">
                    {firstArticleRef && (
                      <label
                        className="bs-integrate-toggle"
                        title="写回增量笔记的同时，让 AI 结合原文与回写内容生成整理稿，弹窗确认后应用回原文"
                      >
                        <input
                          type="checkbox"
                          checked={integrateOriginal}
                          onChange={(event) =>
                            setIntegrateOriginal(event.target.checked)
                          }
                        />
                        同时整理回原文
                      </label>
                    )}
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || done}
                      onClick={async () => {
                        try {
                          const data = await act({
                            action: "increment",
                            folder: "00-Inbox",
                          });
                          if (data) {
                            setSession((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    increments: data.increments,
                                    incrementLog: data.log,
                                  }
                                : prev,
                            );
                            setNotice(`已新建增量笔记：${data.relativePath}`);
                            if (integrateOriginal && firstArticleRef) {
                              try {
                                const merged = await act({
                                  action: "integrate-reference",
                                  refId: firstArticleRef.id,
                                });
                                if (merged) {
                                  setRevise({
                                    articleId: merged.articleId,
                                    title: merged.title,
                                    proposed: merged.proposed,
                                  });
                                  setNotice(
                                    "增量已写回；原文整理稿已生成，请在弹窗中确认后应用",
                                  );
                                }
                              } catch (error) {
                                setNotice(
                                  error instanceof Error
                                    ? error.message
                                    : "原文整理稿生成失败",
                                );
                              }
                            }
                          }
                        } catch (error) {
                          setNotice(
                            error instanceof Error ? error.message : "写回失败",
                          );
                        }
                      }}
                    >
                      写回知识库
                    </button>
                    {!done ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy}
                        onClick={async () => {
                          const data = await safeAct({ action: "done" });
                          if (data) {
                            setSession((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    status: "done",
                                    summary: data.summary,
                                  }
                                : prev,
                            );
                            void loadSessions();
                          }
                        }}
                      >
                        结束会话
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button button-ink"
                      disabled={busy || !composer.trim() || done}
                      onClick={() => {
                        const text = composer;
                        setComposer("");
                        void send(text);
                      }}
                    >
                      {busy ? (
                        <Loader2 className="ai-spinner" aria-hidden="true" />
                      ) : (
                        <Send aria-hidden="true" />
                      )}{" "}
                      发送
                    </button>
                  </div>
                  <div className="bs-under-actions">
                    <p className="bs-write-hint">
                      写回 = 在 00-Inbox 新建增量笔记，不会修改原文。
                      {firstArticleRef && (
                        <>
                          {" "}
                          想更新原文？
                          <button
                            type="button"
                            className="bs-linklike"
                            disabled={reviseBusy || done}
                            onClick={() => void openRevise(firstArticleRef)}
                          >
                            让 AI 修订《{firstArticleRef.title}》
                          </button>
                        </>
                      )}
                    </p>
                    {session.incrementLog &&
                      session.incrementLog.length > 0 && (
                        <div className="bs-increment-log">
                          <span className="micro-label">写回记录</span>
                          {session.incrementLog.map((entry) => (
                            <button
                              type="button"
                              className="bs-increment-chip"
                              key={entry.path}
                              title={`打开 ${entry.path}`}
                              onClick={() => void openIncrement(entry.path)}
                            >
                              <FileText aria-hidden="true" /> {entry.title}
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {pickerOpen && (
        <div
          className="bs-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="选择参考资料"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bs-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bs-modal-head">
              <h3>挂载参考资料</h3>
              <button
                type="button"
                className="bs-card-delete"
                aria-label="关闭"
                onClick={() => setPickerOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="bs-picker-tabs">
              <button
                type="button"
                className={pickerTab === "article" ? "active" : ""}
                onClick={() => setPickerTab("article")}
              >
                文章
              </button>
              <button
                type="button"
                className={pickerTab === "folder" ? "active" : ""}
                onClick={() => setPickerTab("folder")}
              >
                文件夹
              </button>
              <input
                className="bs-picker-search"
                placeholder="搜索标题 / 路径…"
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
              />
            </div>
            <div className="bs-picker-list">
              {pickerTab === "article"
                ? pickerArticles
                    .filter((item) =>
                      item.title
                        .toLowerCase()
                        .includes(pickerQuery.trim().toLowerCase()),
                    )
                    .slice(0, 80)
                    .map((item) => (
                      <button
                        type="button"
                        className="bs-picker-item"
                        key={item.articleId}
                        onClick={() =>
                          void attachRef({
                            type: "article",
                            articleId: item.articleId,
                            title: item.title,
                          })
                        }
                      >
                        <FileText aria-hidden="true" /> {item.title}
                      </button>
                    ))
                : pickerFolders
                    .filter((item) =>
                      `${item.path} ${item.name}`
                        .toLowerCase()
                        .includes(pickerQuery.trim().toLowerCase()),
                    )
                    .slice(0, 80)
                    .map((item) => (
                      <button
                        type="button"
                        className="bs-picker-item"
                        key={item.path}
                        onClick={() =>
                          void attachRef({
                            type: "folder",
                            path: item.path,
                            title: item.name,
                          })
                        }
                      >
                        <FolderOpen aria-hidden="true" /> {item.path}
                      </button>
                    ))}
            </div>
          </div>
        </div>
      )}

      {reviseBusy && !revise && (
        <div
          className="bs-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="AI 修订中"
        >
          <div className="bs-modal bs-modal--center">
            <Loader2 className="ai-spinner" aria-hidden="true" />
            <p>AI 正在结合讨论修订文章，稍候…</p>
          </div>
        </div>
      )}

      {revise && (
        <div
          className="bs-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="AI 修订建议"
          onClick={() => setRevise(null)}
        >
          <div
            className="bs-modal bs-modal--wide"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bs-modal-head">
              <h3>AI 修订建议 ·《{revise.title}》</h3>
              <button
                type="button"
                className="bs-card-delete"
                aria-label="关闭"
                onClick={() => setRevise(null)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <textarea
              className="textarea bs-revise-editor"
              value={revise.proposed}
              onChange={(event) =>
                setRevise((prev) =>
                  prev ? { ...prev, proposed: event.target.value } : prev,
                )
              }
            />
            <div className="bs-modal-foot">
              <span className="annotation-ai-hint-inline">
                应用前可再编辑；应用后写回原文并同步 Obsidian。
              </span>
              <div className="bs-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setRevise(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="button button-purple"
                  disabled={reviseBusy || !revise.proposed.trim()}
                  onClick={() => void applyRevise()}
                >
                  {reviseBusy ? (
                    <Loader2 className="ai-spinner" aria-hidden="true" />
                  ) : (
                    <Wand2 aria-hidden="true" />
                  )}{" "}
                  应用修订
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {guideOpen && (
        <div
          className="bs-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="头脑风暴怎么玩"
          onClick={() => setGuideOpen(false)}
        >
          <div
            className="bs-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bs-modal-head">
              <h3>头脑风暴怎么玩</h3>
              <button
                type="button"
                className="bs-card-delete"
                aria-label="关闭"
                onClick={() => setGuideOpen(false)}
                style={{ opacity: 1 }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="bs-guide-steps">
              <div className="bs-guide-step">
                <span>1</span>
                <div>
                  <strong>丢一个真实问题</strong>
                  <p>
                    越具体越好，比如「高播放视频的成功该不该分层判断？」。含糊的大话题很难推演出结论。
                  </p>
                </div>
              </div>
              <div className="bs-guide-step">
                <span>2</span>
                <div>
                  <strong>挂载参考资料（可选）</strong>
                  <p>
                    点「+」选一篇文章或文件夹。AI
                    会以它为事实底座推演，之后还能让 AI 直接修订这篇文章并写回
                    Obsidian。
                  </p>
                </div>
              </div>
              <div className="bs-guide-step">
                <span>3</span>
                <div>
                  <strong>推演并收命题</strong>
                  <p>
                    AI 每轮给 2-3
                    个角度。看到值得验证的判断，点回复下方的「确认为命题」，记进台账。
                  </p>
                </div>
              </div>
              <div className="bs-guide-step">
                <span>4</span>
                <div>
                  <strong>规划探索路线（左栏卡片）</strong>
                  <p>
                    AI
                    会把所有角度一次性抛出。对任意角度点「子路线」即开一条子探索路线；也可点「✨
                    AI
                    规划」批量生成或手动输入。探索完点路线右侧状态芯片推进：open
                    → exploring → completed / supported-with-gaps。路线 =
                    还要查什么。
                  </p>
                </div>
              </div>
              <div className="bs-guide-step">
                <span>5</span>
                <div>
                  <strong>打磨命题台账（右栏卡片）</strong>
                  <p>
                    对任意角度点「入台账」，或在 AI
                    回复下方点「确认为命题」整条收进台账；然后逐条：点状态芯片接受/修订、✍
                    改措辞、🛡 让 AI 补「边界」、✍ 手写「你的决定」。台账 =
                    已经确定了什么，写回时全部整理进知识库。
                  </p>
                </div>
              </div>
              <div className="bs-guide-step">
                <span>6</span>
                <div>
                  <strong>写回与结束</strong>
                  <p>
                    「写回知识库」把路线 + 台账 + 推演写成 Obsidian
                    笔记；「结束会话」生成一句总结，下次接着来。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BrainstormPage() {
  const [mode, setMode] = useState<"reasoning" | "knowledge">("knowledge");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("mode");
    if (requested === "reasoning" || requested === "knowledge") {
      queueMicrotask(() => setMode(requested));
    }
  }, []);

  return (
    <>
      <div
        className="brainstorm-mode-switch"
        role="group"
        aria-label="头脑风暴模式"
      >
        <button
          type="button"
          className={mode === "knowledge" ? "is-active" : ""}
          aria-pressed={mode === "knowledge"}
          onClick={() => setMode("knowledge")}
        >
          <Library aria-hidden="true" /> 知识库模式
        </button>
        <button
          type="button"
          className={mode === "reasoning" ? "is-active" : ""}
          aria-pressed={mode === "reasoning"}
          onClick={() => setMode("reasoning")}
        >
          <BrainCircuit aria-hidden="true" /> 推理模式
        </button>
      </div>
      {mode === "knowledge" ? (
        <KnowledgeBrainstorm />
      ) : (
        <ReasoningBrainstormPage />
      )}
    </>
  );
}

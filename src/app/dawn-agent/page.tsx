"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Code2,
  Database,
  FileCode2,
  Folder,
  FolderOpen,
  GitCompareArrows,
  Loader2,
  MemoryStick,
  Plus,
  Search,
  Send,
  Save,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { renderMiniMarkdown } from "@/lib/mini-markdown";

type AgentEvent = {
  id: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type Approval = {
  id: string;
  toolName: string;
  riskLevel: string;
  summary: string;
  status: string;
  arguments: Record<string, unknown>;
  preview?: ChangePreview | null;
  selectedHunks?: string[] | null;
  createdAt: string;
};

type DiffHunk = {
  id: string;
  index: number;
  oldStart: number;
  newStart: number;
  oldText: string;
  newText: string;
  additions: number;
  deletions: number;
  truncated: boolean;
};

type ChangePreview = {
  kind: "edit" | "write";
  path: string;
  state: "create" | "modify";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  warning?: string;
};

type AgentSession = {
  id: string;
  title: string;
  status: string;
  model?: string | null;
  thinkingLevel: string;
  permissionMode: "supervised" | "full_control";
  updatedAt: string;
  events?: AgentEvent[];
  approvals?: Approval[];
  project?: Project;
};

type Project = {
  id: string;
  name: string;
  rootPath: string;
  realPath: string;
  sessions: AgentSession[];
};

type Handoff = {
  id: string;
  sourceType: string;
  sourceTitle: string;
  sourcePath?: string | null;
  sourceRef?: string | null;
  selectedText?: string | null;
  context?: string | null;
  instruction?: string | null;
  status: string;
  sessionId?: string | null;
};

type ProjectMemory = {
  id: string;
  title: string;
  content: string;
  kind: string;
  sourceType: string;
  enabled: boolean;
  updatedAt: string;
};

type BrowserState = {
  path: string;
  parentPath: string | null;
  folders: { name: string; path: string }[];
};

function statusLabel(status: string) {
  return (
    {
      idle: "待命",
      running: "执行中",
      awaiting_approval: "等待审批",
      stopped: "已停止",
      error: "需要检查",
    }[status] ?? status
  );
}

function pretty(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function durationLabel(value: unknown) {
  const milliseconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
}

export default function DawnAgentPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<AgentSession | null>(null);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AgentEvent | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryKind, setMemoryKind] = useState("fact");
  const [inspectorTab, setInspectorTab] = useState<
    "changes" | "details" | "memory"
  >("changes");
  const [hunkSelections, setHunkSelections] = useState<
    Record<string, string[]>
  >({});
  const [railOpen, setRailOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [streamState, setStreamState] = useState<
    "connecting" | "live" | "fallback"
  >("connecting");
  const [permissionModeDraft, setPermissionModeDraft] = useState<
    "supervised" | "full_control"
  >("supervised");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const registerInputRef = useRef<HTMLInputElement | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/dawn-agent/projects", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "项目列表加载失败");
    const next = Array.isArray(data.projects) ? data.projects : [];
    setProjects(next);
    setProjectId((current) => current || next[0]?.id || "");
  }, []);

  const loadSession = useCallback(async (id: string) => {
    if (!id) {
      setSession(null);
      return;
    }
    const response = await fetch(`/api/dawn-agent/sessions/${id}`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "会话加载失败");
    setSession(data);
    setPermissionModeDraft(
      data.permissionMode === "full_control" ? "full_control" : "supervised",
    );
  }, []);

  const loadMemories = useCallback(async (id: string) => {
    if (!id) {
      setMemories([]);
      return;
    }
    const response = await fetch(`/api/dawn-agent/projects/${id}/memories`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "项目记忆加载失败");
    setMemories(Array.isArray(data.memories) ? data.memories : []);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadProjects().catch(() => setNotice("项目列表加载失败"));
      if (window.matchMedia("(max-width: 900px)").matches) setRailOpen(false);
      if (window.matchMedia("(max-width: 1240px)").matches)
        setInspectorOpen(false);
    });
    const handoffId = new URLSearchParams(window.location.search).get(
      "handoff",
    );
    if (handoffId) {
      fetch(`/api/dawn-agent/handoffs/${encodeURIComponent(handoffId)}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "交接内容加载失败");
          setHandoff(data);
          setComposer(
            data.instruction ||
              "请先理解这份来源上下文，再结合目标项目给出可验证的行动方案。",
          );
        })
        .catch((error) =>
          setNotice(
            error instanceof Error ? error.message : "交接内容加载失败",
          ),
        );
    }
  }, [loadProjects]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadMemories(projectId).catch((error) =>
        setNotice(error instanceof Error ? error.message : "项目记忆加载失败"),
      );
    });
  }, [loadMemories, projectId]);

  useEffect(() => {
    if (!selectedProject) return;
    if (!selectedProject.sessions.some((item) => item.id === sessionId)) {
      queueMicrotask(() => setSessionId(selectedProject.sessions[0]?.id ?? ""));
    }
  }, [selectedProject, sessionId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadSession(sessionId).catch((error) =>
        setNotice(error instanceof Error ? error.message : "会话加载失败"),
      );
    });
  }, [loadSession, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setStreamState("connecting");
    });
    let lastSignalAt = Date.now();
    let refreshTimer: number | undefined;
    const source = new EventSource(
      `/api/dawn-agent/sessions/${encodeURIComponent(sessionId)}/events`,
    );
    const refresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void Promise.all([loadSession(sessionId), loadProjects()]).catch(
          () => undefined,
        );
      }, 70);
    };
    source.onopen = () => {
      lastSignalAt = Date.now();
      setStreamState("live");
    };
    source.addEventListener("refresh", () => {
      lastSignalAt = Date.now();
      setStreamState("live");
      refresh();
    });
    source.addEventListener("heartbeat", () => {
      lastSignalAt = Date.now();
      setStreamState("live");
    });
    source.addEventListener("degraded", () => setStreamState("fallback"));
    source.onerror = () => setStreamState("fallback");
    const fallback = window.setInterval(() => {
      if (Date.now() - lastSignalAt < 25_000) return;
      setStreamState("fallback");
      refresh();
    }, 5_000);
    return () => {
      disposed = true;
      source.close();
      window.clearInterval(fallback);
      window.clearTimeout(refreshTimer);
    };
  }, [loadProjects, loadSession, sessionId]);

  useEffect(() => {
    if (!registerOpen) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() =>
      registerInputRef.current?.focus(),
    );
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setRegisterOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [registerOpen]);

  useEffect(() => {
    const el = timelineRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.events?.length]);

  async function browse(path?: string) {
    setBrowserBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/dawn-agent/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "文件夹不可用");
      setBrowser(data);
      setPathDraft(data.path);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文件夹不可用");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function registerProject() {
    if (!pathDraft.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/dawn-agent/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: pathDraft.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "项目注册失败");
      await loadProjects();
      setProjectId(data.id);
      setSessionId("");
      setRegisterOpen(false);
      setBrowser(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "项目注册失败");
    } finally {
      setBusy(false);
    }
  }

  async function createSession(useHandoff = false) {
    if (!projectId) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/dawn-agent/projects/${projectId}/sessions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title:
              useHandoff && handoff ? handoff.sourceTitle : "新的 Agent 任务",
            thinkingLevel: "high",
            permissionMode: permissionModeDraft,
            handoffId: useHandoff ? handoff?.id : undefined,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "会话创建失败");
      await loadProjects();
      setSessionId(data.id);
      if (useHandoff && handoff)
        setHandoff((current) =>
          current
            ? { ...current, status: "accepted", sessionId: data.id }
            : current,
        );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "会话创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function attachHandoff() {
    if (!sessionId || !handoff) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/dawn-agent/sessions/${sessionId}/handoff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handoffId: handoff.id }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "上下文接收失败");
      setHandoff((current) =>
        current ? { ...current, status: "accepted", sessionId } : current,
      );
      setComposer(handoff.instruction || "请基于刚接收的上下文继续这个任务。");
      await loadSession(sessionId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "上下文接收失败");
    } finally {
      setBusy(false);
    }
  }

  async function dismissHandoff() {
    if (!handoff) return;
    try {
      const response = await fetch(`/api/dawn-agent/handoffs/${handoff.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "交接内容处理失败");
      setHandoff(null);
      window.history.replaceState({}, "", "/dawn-agent");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "交接内容处理失败");
    }
  }

  async function send() {
    const content = composer.trim();
    if (!sessionId || !content || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/dawn-agent/sessions/${sessionId}/message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "任务启动失败");
      setComposer("");
      await loadSession(sessionId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "任务启动失败");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!sessionId) return;
    await fetch(`/api/dawn-agent/sessions/${sessionId}/abort`, {
      method: "POST",
    });
    await loadSession(sessionId);
  }

  async function changePermissionMode(
    permissionMode: "supervised" | "full_control",
  ) {
    if (!sessionId) {
      setPermissionModeDraft(permissionMode);
      setNotice(
        permissionMode === "full_control"
          ? "新任务将使用完全控制：项目内修改和普通命令自动执行"
          : "新任务将使用受控模式：写入和命令逐次审批",
      );
      return;
    }
    setPermissionBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/dawn-agent/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionMode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "权限模式更新失败");
      setPermissionModeDraft(permissionMode);
      setSession((current) =>
        current ? { ...current, permissionMode } : current,
      );
      setNotice(
        permissionMode === "full_control"
          ? "已启用完全控制：项目内修改和普通命令不再询问"
          : "已切换到受控模式：后续写入和命令需要审批",
      );
      await loadSession(sessionId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "权限模式更新失败");
    } finally {
      setPermissionBusy(false);
    }
  }

  async function decide(approvalId: string, decision: "approved" | "denied") {
    setNotice("");
    const approval = session?.approvals?.find((item) => item.id === approvalId);
    const selectedHunkIds =
      approval?.preview?.kind === "edit"
        ? (hunkSelections[approvalId] ??
          approval.preview.hunks.map((hunk) => hunk.id))
        : undefined;
    if (
      decision === "approved" &&
      approval?.preview?.kind === "edit" &&
      selectedHunkIds?.length === 0
    ) {
      setNotice("至少选择一个编辑块，或直接拒绝本次修改");
      return;
    }
    const response = await fetch(
      `/api/dawn-agent/sessions/${sessionId}/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, decision, selectedHunkIds }),
      },
    );
    const data = await response.json();
    if (!response.ok) setNotice(data.error || "审批失败");
    await loadSession(sessionId);
  }

  async function saveMemory(input?: {
    title: string;
    content: string;
    sourceRef?: string;
  }) {
    if (!projectId) return;
    const title = input?.title ?? memoryTitle;
    const content = input?.content ?? memoryContent;
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/dawn-agent/projects/${projectId}/memories`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            kind: input ? "decision" : memoryKind,
            sourceType: input ? "session" : "manual",
            sourceRef: input?.sourceRef,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "项目记忆保存失败");
      setMemoryTitle("");
      setMemoryContent("");
      setNotice("已加入项目记忆，后续任务会自动携带");
      await loadMemories(projectId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "项目记忆保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMemory(memory: ProjectMemory) {
    const response = await fetch(
      `/api/dawn-agent/projects/${projectId}/memories/${memory.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !memory.enabled }),
      },
    );
    if (response.ok) await loadMemories(projectId);
  }

  async function removeMemory(id: string) {
    const response = await fetch(
      `/api/dawn-agent/projects/${projectId}/memories/${id}`,
      { method: "DELETE" },
    );
    if (response.ok) await loadMemories(projectId);
  }

  async function writeback(eventId?: string) {
    if (!sessionId) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/dawn-agent/sessions/${sessionId}/writeback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "回写知识库失败");
      setNotice(`已回写 Obsidian：${data.path}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "回写知识库失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeSession(id: string) {
    const response = await fetch(`/api/dawn-agent/sessions/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setNotice(data.error || "删除会话失败");
      return;
    }
    if (sessionId === id) setSessionId("");
    await loadProjects();
  }

  const approvals = session?.approvals ?? [];
  const pendingApprovals = approvals.filter(
    (item) => item.status === "pending",
  );
  const activePermissionMode = session?.permissionMode ?? permissionModeDraft;
  const inspectorEvent =
    selectedEvent ??
    [...(session?.events ?? [])]
      .reverse()
      .find((item) => item.type.startsWith("tool_")) ??
    null;

  function toggleHunk(approval: Approval, hunkId: string) {
    const all = approval.preview?.hunks.map((hunk) => hunk.id) ?? [];
    setHunkSelections((current) => {
      const selected = current[approval.id] ?? all;
      return {
        ...current,
        [approval.id]: selected.includes(hunkId)
          ? selected.filter((id) => id !== hunkId)
          : [...selected, hunkId],
      };
    });
  }

  return (
    <main className="dawn-agent-page">
      <header className="dawn-agent-header">
        <div>
          <p className="micro-label">LOCAL PROJECT HARNESS</p>
          <h1>Dawn Agent</h1>
          <p>让 Pi 在你批准的项目目录里理解、修改并验证代码。</p>
        </div>
        <div className="dawn-agent-header__actions">
          <span
            className={`dawn-trust-badge ${activePermissionMode === "full_control" ? "is-full-control" : ""}`}
          >
            {activePermissionMode === "full_control" ? (
              <Zap />
            ) : (
              <ShieldCheck />
            )}
            {activePermissionMode === "full_control"
              ? "项目内完全控制"
              : "本地权限门"}
          </span>
          <div
            className="dawn-permission-switch"
            aria-label="Dawn Agent 权限模式"
            title="完全控制会自动执行项目内修改和普通命令；路径越界、密钥、提权、推送和部署仍会阻止"
          >
            <button
              type="button"
              className={
                activePermissionMode === "supervised" ? "is-active" : ""
              }
              aria-pressed={activePermissionMode === "supervised"}
              disabled={permissionBusy}
              onClick={() => void changePermissionMode("supervised")}
            >
              <ShieldCheck />
              受控
            </button>
            <button
              type="button"
              className={
                activePermissionMode === "full_control" ? "is-active" : ""
              }
              aria-pressed={activePermissionMode === "full_control"}
              disabled={permissionBusy}
              onClick={() => void changePermissionMode("full_control")}
            >
              <Zap />
              完全控制
            </button>
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setRegisterOpen(true);
              if (!browser) void browse();
            }}
          >
            <FolderOpen /> 选择项目
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => void createSession()}
            disabled={!projectId || busy}
          >
            <Plus /> 新任务
          </button>
        </div>
      </header>

      {notice && (
        <div className="dawn-agent-notice" role="status">
          {notice}
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="关闭通知"
          >
            <X />
          </button>
        </div>
      )}

      {handoff && (
        <section
          className={`dawn-handoff ${handoff.status === "accepted" ? "is-accepted" : ""}`}
        >
          <span className="dawn-handoff__icon">
            {handoff.sourceType === "knowledge" ? <Database /> : <BookOpen />}
          </span>
          <div className="dawn-handoff__copy">
            <small>
              {handoff.status === "accepted"
                ? "CONTEXT ATTACHED"
                : "INCOMING CONTEXT"}
            </small>
            <strong>{handoff.sourceTitle}</strong>
            <p>
              {handoff.instruction || "这份来源内容已准备好交给 Dawn Agent。"}
            </p>
            {handoff.selectedText && (
              <blockquote>
                {handoff.selectedText.slice(0, 360)}
                {handoff.selectedText.length > 360 ? "…" : ""}
              </blockquote>
            )}
          </div>
          <div className="dawn-handoff__actions">
            {handoff.status === "accepted" ? (
              <span>
                <Check />
                已接入
                {handoff.sessionId === sessionId ? "当前会话" : " Agent 任务"}
              </span>
            ) : (
              <>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => void dismissHandoff()}
                  disabled={busy}
                >
                  稍后
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => void attachHandoff()}
                  disabled={!sessionId || busy}
                >
                  接入当前会话
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void createSession(true)}
                  disabled={!projectId || busy}
                >
                  <Plus />
                  新任务接收
                </button>
              </>
            )}
          </div>
        </section>
      )}

      <section
        className={`dawn-agent-shell ${!railOpen ? "dawn-agent-shell--rail-closed" : ""} ${!inspectorOpen ? "dawn-agent-shell--inspector-closed" : ""}`}
      >
        <aside className="dawn-project-rail">
          <div className="dawn-rail-heading">
            <div>
              <span>PROJECTS</span>
              <strong>本地工作区</strong>
            </div>
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              aria-label="收起项目栏"
            >
              <ChevronLeft />
            </button>
          </div>
          <div className="dawn-project-list">
            {projects.map((project) => (
              <div
                key={project.id}
                className={`dawn-project ${project.id === projectId ? "is-active" : ""}`}
              >
                <button
                  type="button"
                  className="dawn-project__main"
                  onClick={() => {
                    setProjectId(project.id);
                    setSessionId(project.sessions[0]?.id ?? "");
                  }}
                >
                  <Folder />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.realPath}</small>
                  </span>
                </button>
                {project.id === projectId && (
                  <div className="dawn-session-list">
                    {project.sessions.map((item) => (
                      <div className="dawn-session-row" key={item.id}>
                        <button
                          type="button"
                          className={`dawn-session-link ${item.id === sessionId ? "is-active" : ""}`}
                          onClick={() => setSessionId(item.id)}
                        >
                          <span
                            className={`dawn-status-dot is-${item.status}`}
                          />
                          <span>
                            <strong>{item.title}</strong>
                            <small>{statusLabel(item.status)}</small>
                          </span>
                        </button>
                        <button
                          className="dawn-session-delete"
                          type="button"
                          onClick={() => void removeSession(item.id)}
                          aria-label={`删除会话 ${item.title}`}
                        >
                          <Trash2 />
                        </button>
                      </div>
                    ))}
                    {project.sessions.length === 0 && (
                      <p className="dawn-empty-copy">
                        创建一个任务，Dawn Agent 会在这里保留上下文。
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {projects.length === 0 && (
              <button
                className="dawn-project-empty"
                type="button"
                onClick={() => {
                  setRegisterOpen(true);
                  void browse();
                }}
              >
                <FolderOpen />
                <strong>选择第一个项目</strong>
                <span>仅注册真实路径，不上传项目文件。</span>
              </button>
            )}
          </div>
        </aside>

        {!railOpen && (
          <button
            className="dawn-edge-toggle dawn-edge-toggle--left"
            type="button"
            onClick={() => setRailOpen(true)}
            aria-label="展开项目栏"
          >
            <ChevronRight />
          </button>
        )}

        <section className="dawn-agent-thread">
          <div className="dawn-thread-toolbar">
            <div>
              <span
                className={`dawn-status-dot is-${session?.status ?? "idle"}`}
              />
              <strong>{session?.title ?? "选择项目并创建任务"}</strong>
              {session?.model && (
                <small>
                  {session.model} · thinking {session.thinkingLevel}
                </small>
              )}
              {session && (
                <span
                  className={`dawn-stream-state is-${streamState}`}
                  title="Dawn Agent 事件连接状态"
                >
                  <Activity />
                  {streamState === "live"
                    ? "实时"
                    : streamState === "fallback"
                      ? "回退刷新"
                      : "连接中"}
                </span>
              )}
            </div>
            <div>
              {(session?.status === "running" ||
                session?.status === "awaiting_approval") && (
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => void stop()}
                >
                  <CircleStop /> 停止
                </button>
              )}
              <button
                className="icon-button"
                type="button"
                onClick={() => setInspectorOpen((value) => !value)}
                aria-label="切换检查器"
              >
                <Code2 />
              </button>
            </div>
          </div>

          <div className="dawn-timeline" ref={timelineRef}>
            {!session && (
              <div className="dawn-welcome">
                <span>
                  <Bot />
                </span>
                <p className="micro-label">READY WHEN YOU ARE</p>
                <h2>把一个真实项目交给 Dawn Agent</h2>
                <p>
                  它会先读取结构和约束，再提出或执行下一步。受控模式逐次审批；完全控制会自动执行项目内操作。
                </p>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setRegisterOpen(true);
                      void browse();
                    }}
                  >
                    <FolderOpen />
                    选择项目
                  </button>
                  <button
                    type="button"
                    onClick={() => void createSession()}
                    disabled={!projectId}
                  >
                    <Plus />
                    创建任务
                  </button>
                </div>
              </div>
            )}
            {session && (session.events?.length ?? 0) === 0 && (
              <div className="dawn-task-starters">
                <p className="micro-label">START WITH EVIDENCE</p>
                <h2>你希望在这个项目里完成什么？</h2>
                {[
                  "先阅读项目结构与 AGENTS.md，给我一份架构摘要",
                  "诊断当前构建或测试失败的原因，先不要修改",
                  "实现一个功能，先给出修改计划再开始",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setComposer(prompt)}
                  >
                    {prompt}
                    <ChevronRight />
                  </button>
                ))}
              </div>
            )}
            {(session?.events ?? []).map((event) => {
              if (event.type === "user")
                return (
                  <article
                    key={event.id}
                    className="dawn-event dawn-event--user"
                  >
                    <small>
                      你 ·{" "}
                      {new Date(event.createdAt).toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                    <p>{String(event.payload.content ?? "")}</p>
                  </article>
                );
              if (event.type === "assistant")
                return (
                  <article
                    key={event.id}
                    className="dawn-event dawn-event--assistant"
                  >
                    <div className="dawn-event__author">
                      <span>
                        <Bot />
                      </span>
                      <strong>Dawn Agent</strong>
                    </div>
                    <div
                      className="mini-markdown"
                      dangerouslySetInnerHTML={{
                        __html: renderMiniMarkdown(
                          String(event.payload.content ?? ""),
                        ),
                      }}
                    />
                    <footer className="dawn-event__actions">
                      <button
                        type="button"
                        onClick={() =>
                          void saveMemory({
                            title: `${session?.title ?? "Agent 会话"} · 结论`,
                            content: String(event.payload.content ?? ""),
                            sourceRef: event.id,
                          })
                        }
                      >
                        <MemoryStick />
                        记为项目记忆
                      </button>
                      <button
                        type="button"
                        onClick={() => void writeback(event.id)}
                      >
                        <Database />
                        回写知识库
                      </button>
                    </footer>
                  </article>
                );
              if (event.type === "tool_start" || event.type === "tool_end")
                return (
                  <button
                    key={event.id}
                    type="button"
                    className={`dawn-tool-event ${selectedEvent?.id === event.id ? "is-active" : ""}`}
                    onClick={() => {
                      setSelectedEvent(event);
                      setInspectorTab("details");
                      setInspectorOpen(true);
                    }}
                  >
                    {event.payload.toolName === "bash" ? (
                      <Terminal />
                    ) : event.payload.toolName === "edit" ||
                      event.payload.toolName === "write" ? (
                      <FileCode2 />
                    ) : (
                      <Search />
                    )}
                    <span>
                      <strong>
                        {String(event.payload.toolName ?? "tool")}
                      </strong>
                      <small>
                        {event.type === "tool_end"
                          ? `${event.payload.isError ? "执行失败" : "执行完成"}${durationLabel(event.payload.durationMs) ? ` · ${durationLabel(event.payload.durationMs)}` : ""}`
                          : "正在执行"}
                      </small>
                    </span>
                    <ChevronRight />
                  </button>
                );
              if (event.type === "error" || event.type === "security")
                return (
                  <article
                    key={event.id}
                    className="dawn-event dawn-event--system"
                  >
                    <ShieldCheck />
                    <span>
                      {String(
                        event.payload.message ??
                          event.payload.reason ??
                          "操作被权限策略阻止",
                      )}
                    </span>
                  </article>
                );
              if (event.type === "permission_mode")
                return (
                  <article
                    key={event.id}
                    className="dawn-event dawn-event--system dawn-event--permission"
                  >
                    {event.payload.permissionMode === "full_control" ? (
                      <Zap />
                    ) : (
                      <ShieldCheck />
                    )}
                    <span>
                      {event.payload.permissionMode === "full_control"
                        ? "已启用完全控制，项目内修改与普通命令将自动执行。"
                        : "已恢复受控模式，后续写入与命令需要逐次审批。"}
                    </span>
                  </article>
                );
              return null;
            })}
            {pendingApprovals.map((approval) => (
              <article key={approval.id} className="dawn-approval-card">
                <header>
                  <ShieldCheck />
                  <div>
                    <span>{approval.riskLevel.toUpperCase()} RISK</span>
                    <h3>需要你的批准</h3>
                  </div>
                </header>
                <p>{approval.summary}</p>
                {approval.preview ? (
                  <DiffReview
                    approval={approval}
                    selected={
                      hunkSelections[approval.id] ??
                      approval.preview.hunks.map((hunk) => hunk.id)
                    }
                    onToggle={(hunkId) => toggleHunk(approval, hunkId)}
                  />
                ) : (
                  <pre>{pretty(approval.arguments)}</pre>
                )}
                <div>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => void decide(approval.id, "denied")}
                  >
                    <X />
                    拒绝
                  </button>
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => void decide(approval.id, "approved")}
                  >
                    <Check />
                    {approval.preview?.kind === "edit"
                      ? "批准所选修改"
                      : "批准一次"}
                  </button>
                </div>
              </article>
            ))}
            {session?.status === "running" && (
              <div className="dawn-working">
                <Loader2 />
                <span>Dawn Agent 正在阅读、推理或验证…</span>
              </div>
            )}
          </div>

          <div className="dawn-composer">
            <textarea
              rows={3}
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={
                session
                  ? "描述任务，或继续补充要求…（Enter 发送，Shift+Enter 换行）"
                  : "先选择项目并创建任务"
              }
              disabled={
                !session ||
                session.status === "running" ||
                session.status === "awaiting_approval"
              }
            />
            <div>
              <span>
                {activePermissionMode === "full_control" ? (
                  <Zap />
                ) : (
                  <ShieldCheck />
                )}
                {activePermissionMode === "full_control"
                  ? "项目内写入与命令自动执行"
                  : "写入与命令逐次审批"}
              </span>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void send()}
                disabled={
                  !session ||
                  !composer.trim() ||
                  busy ||
                  session.status === "running" ||
                  session.status === "awaiting_approval"
                }
              >
                {busy ? <Loader2 className="spin" /> : <Send />} 发送
              </button>
            </div>
          </div>
        </section>

        <aside className="dawn-inspector">
          <div className="dawn-inspector__heading">
            <div>
              <span>WORKBENCH</span>
              <strong>执行检查器</strong>
            </div>
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              aria-label="关闭执行检查器"
            >
              <X />
            </button>
          </div>
          <div
            className="dawn-inspector-tabs"
            role="tablist"
            aria-label="执行检查器"
          >
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "changes"}
              className={inspectorTab === "changes" ? "is-active" : ""}
              onClick={() => setInspectorTab("changes")}
            >
              <GitCompareArrows />
              变更
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "details"}
              className={inspectorTab === "details" ? "is-active" : ""}
              onClick={() => setInspectorTab("details")}
            >
              <Terminal />
              工具
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "memory"}
              className={inspectorTab === "memory" ? "is-active" : ""}
              onClick={() => setInspectorTab("memory")}
            >
              <MemoryStick />
              记忆{" "}
              <small>{memories.filter((item) => item.enabled).length}</small>
            </button>
          </div>
          {inspectorTab === "changes" && (
            <div className="dawn-change-center">
              <header>
                <strong>变更审查</strong>
                <span>{approvals.length} 次授权记录</span>
              </header>
              {approvals.length ? (
                approvals.map((approval) => (
                  <article
                    className={`dawn-change-record is-${approval.status}`}
                    key={approval.id}
                  >
                    <div className="dawn-change-record__head">
                      <span>
                        {approval.status === "pending"
                          ? "待审批"
                          : approval.status === "auto_approved"
                            ? "自动授权"
                            : approval.status === "approved"
                              ? "已批准"
                              : approval.status === "denied"
                                ? "已拒绝"
                                : "已失效"}
                      </span>
                      <strong>
                        {approval.preview?.path ?? approval.toolName}
                      </strong>
                      {approval.preview && (
                        <small>
                          <b>+{approval.preview.additions}</b> /{" "}
                          <i>-{approval.preview.deletions}</i>
                        </small>
                      )}
                    </div>
                    <p>{approval.summary}</p>
                    {approval.preview && (
                      <DiffReview approval={approval} compact />
                    )}
                  </article>
                ))
              ) : (
                <div className="dawn-inspector-empty">
                  <GitCompareArrows />
                  <strong>还没有文件变更</strong>
                  <p>
                    Agent 提交 edit 或 write 后，这里会展示前后
                    Diff；受控模式等待决定，完全控制自动执行并保留审计。
                  </p>
                </div>
              )}
            </div>
          )}
          {inspectorTab === "details" &&
            (inspectorEvent ? (
              <div className="dawn-inspector-content">
                <div className="dawn-inspector-meta">
                  <span>
                    {String(inspectorEvent.payload.toolName ?? "工具")}
                  </span>
                  <small>事件 #{inspectorEvent.sequence}</small>
                </div>
                <pre>
                  {pretty(
                    inspectorEvent.payload.args ??
                      inspectorEvent.payload.result ??
                      inspectorEvent.payload,
                  )}
                </pre>
                <p>
                  这里展示经过脱敏和长度限制的工具输入/输出。完整项目文件仍只存在于本机。
                </p>
              </div>
            ) : (
              <div className="dawn-inspector-empty">
                <Code2 />
                <strong>等待工具事件</strong>
                <p>读取、命令、补丁和验证结果会在这里展开。</p>
              </div>
            ))}
          {inspectorTab === "memory" && (
            <div className="dawn-memory-panel">
              <header>
                <strong>项目长期记忆</strong>
                <p>
                  启用的内容会在每轮任务中注入；与代码冲突时，Agent
                  必须以项目文件为准。
                </p>
              </header>
              <div className="dawn-memory-form">
                <input
                  aria-label="记忆标题"
                  value={memoryTitle}
                  onChange={(event) => setMemoryTitle(event.target.value)}
                  placeholder="记忆标题，例如：测试命令"
                />
                <select
                  aria-label="记忆类型"
                  value={memoryKind}
                  onChange={(event) => setMemoryKind(event.target.value)}
                >
                  <option value="fact">项目事实</option>
                  <option value="decision">既有决策</option>
                  <option value="preference">协作偏好</option>
                  <option value="workflow">工作流程</option>
                </select>
                <textarea
                  aria-label="记忆内容"
                  rows={4}
                  value={memoryContent}
                  onChange={(event) => setMemoryContent(event.target.value)}
                  placeholder="写下后续任务应持续知道的内容…"
                />
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void saveMemory()}
                  disabled={
                    busy || !memoryTitle.trim() || !memoryContent.trim()
                  }
                >
                  <Save />
                  保存记忆
                </button>
              </div>
              <div className="dawn-memory-list">
                {memories.map((memory) => (
                  <article
                    className={!memory.enabled ? "is-disabled" : ""}
                    key={memory.id}
                  >
                    <div>
                      <span>{memory.kind}</span>
                      <strong>{memory.title}</strong>
                    </div>
                    <p>{memory.content}</p>
                    <footer>
                      <button
                        type="button"
                        onClick={() => void toggleMemory(memory)}
                      >
                        {memory.enabled ? "暂停注入" : "重新启用"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeMemory(memory.id)}
                      >
                        <Trash2 />
                        删除
                      </button>
                    </footer>
                  </article>
                ))}
                {memories.length === 0 && (
                  <div className="dawn-inspector-empty">
                    <MemoryStick />
                    <strong>项目记忆还是空的</strong>
                    <p>可手动添加，也可把 Agent 的某次结论一键沉淀进来。</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </section>

      {registerOpen && (
        <div
          className="dawn-modal-layer"
          role="presentation"
          onMouseDown={() => setRegisterOpen(false)}
        >
          <section
            className="dawn-folder-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="选择本地项目"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="micro-label">REGISTER LOCAL ROOT</p>
                <h2>选择项目文件夹</h2>
                <span>注册后 Agent 的所有路径都被限制在该真实目录内。</span>
              </div>
              <button
                type="button"
                onClick={() => setRegisterOpen(false)}
                aria-label="关闭项目选择器"
              >
                <X />
              </button>
            </header>
            <div className="dawn-folder-path">
              <input
                ref={registerInputRef}
                aria-label="项目文件夹路径"
                value={pathDraft}
                onChange={(event) => setPathDraft(event.target.value)}
                placeholder="/Users/you/Documents/Code/project"
              />
              <button
                className="button button--secondary"
                type="button"
                onClick={() => void browse(pathDraft)}
              >
                打开
              </button>
            </div>
            <div className="dawn-folder-browser">
              <button
                type="button"
                disabled={!browser?.parentPath || browserBusy}
                onClick={() => void browse(browser?.parentPath ?? undefined)}
              >
                <ChevronLeft />
                上一级
              </button>
              <strong>{browser?.path ?? "正在读取…"}</strong>
              {browserBusy ? (
                <div className="dawn-folder-loading">
                  <Loader2 />
                  读取文件夹
                </div>
              ) : (
                browser?.folders.map((folder) => (
                  <button
                    key={folder.path}
                    type="button"
                    onDoubleClick={() => void browse(folder.path)}
                    onClick={() => setPathDraft(folder.path)}
                  >
                    <Folder />
                    <span>{folder.name}</span>
                    <ChevronRight />
                  </button>
                ))
              )}
            </div>
            <footer>
              <span>
                <ShieldCheck />
                不会上传项目；高风险操作必须在此页面批准。
              </span>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void registerProject()}
                disabled={!pathDraft || busy}
              >
                {busy ? <Loader2 /> : <Check />}注册此项目
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

function DiffReview({
  approval,
  selected,
  onToggle,
  compact = false,
}: {
  approval: Approval;
  selected?: string[];
  onToggle?: (hunkId: string) => void;
  compact?: boolean;
}) {
  const preview = approval.preview;
  if (!preview) return null;
  const approvedSelection = approval.selectedHunks?.length
    ? new Set(approval.selectedHunks)
    : new Set(preview.hunks.map((hunk) => hunk.id));
  const currentSelection = new Set(selected ?? approvedSelection);
  return (
    <div className={`dawn-diff ${compact ? "dawn-diff--compact" : ""}`}>
      <header>
        <span>{preview.state === "create" ? "新文件" : "修改文件"}</span>
        <strong>{preview.path}</strong>
        <small>
          <b>+{preview.additions}</b>
          <i>-{preview.deletions}</i>
        </small>
      </header>
      {preview.warning && (
        <p className="dawn-diff__warning">{preview.warning}</p>
      )}
      <div className="dawn-diff__hunks">
        {preview.hunks.map((hunk, index) => {
          const checked = currentSelection.has(hunk.id);
          return (
            <details
              key={hunk.id}
              open={!compact && index === 0}
              className={!checked ? "is-skipped" : ""}
            >
              <summary>
                {preview.kind === "edit" &&
                approval.status === "pending" &&
                onToggle ? (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(hunk.id)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`批准编辑块 ${index + 1}`}
                  />
                ) : (
                  <Check aria-hidden="true" />
                )}
                <span>编辑块 {index + 1}</span>
                <small>
                  原第 {hunk.oldStart} 行 → 新第 {hunk.newStart} 行
                </small>
              </summary>
              <div className="dawn-diff__columns">
                <section>
                  <span>修改前 · -{hunk.deletions}</span>
                  <pre>{hunk.oldText || "∅"}</pre>
                </section>
                <section>
                  <span>修改后 · +{hunk.additions}</span>
                  <pre>{hunk.newText || "∅"}</pre>
                </section>
              </div>
              {hunk.truncated && (
                <p>
                  这个编辑块较长，预览已截断；建议拒绝并让 Agent 拆成更小的
                  edit。
                </p>
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}

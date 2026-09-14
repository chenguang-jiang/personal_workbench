"use client";

import {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  ViewTransition,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AnnotationDesk, type AnnotationTab } from "./AnnotationDesk";
import { HighlightToolbar, type SelectionPosition } from "./HighlightToolbar";
import { MermaidDiagram } from "./MermaidDiagram";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Database,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Printer,
  Sparkles,
  StickyNote,
  Table,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { serializeProse } from "@/lib/serialize-markdown";
import {
  injectTableToolbars,
  insertTableAtSelection,
} from "@/lib/table-edit";
import {
  enhanceQuizSections,
  handleQuizCheckChange,
  quizDayFromName,
  createWrongButton,
  domOptionsSignature,
  optionsSignature,
} from "@/lib/quiz-embed";
import { DeleteDocumentDialog } from "./DeleteDocumentDialog";

interface SiblingFile {
  path: string;
  title: string;
  updatedAt: string;
  articleId: string | null;
}

interface Highlight {
  id: string;
  text: string;
  color: string;
  note: string | null;
  prefix?: string;
  createdAt: string;
}

interface Note {
  id: string;
  content: string;
  quote: string | null;
  createdAt: string;
}

export interface ReaderArticle {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source?: string | null;
  url?: string | null;
  path?: string | null;
  readingProgress: number;
  highlights: Highlight[];
  notes: Note[];
}

export function Reader({
  articleId,
  initialArticle,
  initialCitation,
}: {
  articleId: string;
  initialArticle: ReaderArticle;
  initialCitation?: {
    id: string;
    quote: string;
    startOffset: number;
    endOffset: number;
  } | null;
}) {
  const [article, setArticle] = useState<ReaderArticle | null>(initialArticle);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<SelectionPosition | null>(null);
  const [deskOpen, setDeskOpen] = useState(false);
  const [deskTab, setDeskTab] = useState<AnnotationTab>("note");
  const [deskSelection, setDeskSelection] = useState<{
    text: string;
    context: string;
  } | null>(null);
  const [deskQuestion, setDeskQuestion] = useState("");
  const [deskRequestKey, setDeskRequestKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [undoContent, setUndoContent] = useState<string | null>(null);
  const [flashError, setFlashError] = useState(false);
  const [wide, setWide] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);
  const [siblings, setSiblings] = useState<SiblingFile[]>([]);
  const [siblingFolder, setSiblingFolder] = useState("");
  const [siblingsOpen, setSiblingsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const [editNoticeError, setEditNoticeError] = useState(false);
  const router = useRouter();

  // 题集文章（每日题库）：识别对应日期，读写完成状态，顶栏提供标记完成
  const quizDay = useMemo(() => {
    const rel = article?.url?.startsWith("obsidian://")
      ? article.url.slice("obsidian://".length)
      : (article?.path ?? "");
    if (!rel || !rel.includes("每日题库")) return null;
    return quizDayFromName(rel.split("/").pop() ?? "");
  }, [article]);
  const [quizDone, setQuizDone] = useState(false);
  // 错题本：当前题集已收录的题号
  const [quizWrong, setQuizWrong] = useState<number[]>([]);
  // 同文件夹抽屉里各题集的完成状态（day → done）
  const [quizStatusMap, setQuizStatusMap] = useState<Record<string, boolean>>(
    {},
  );

  useEffect(() => {
    if (!quizDay) return;
    let cancelled = false;
    fetch(`/api/quiz/${quizDay}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        setQuizDone(data?.state?.status === "done");
        if (Array.isArray(data?.wrong)) setQuizWrong(data.wrong);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [quizDay]);

  // 内嵌题块「收录错题」开关：写入库，与题库机错题本同步
  const toggleEmbedWrong = useCallback(
    async (qIndex: number, on: boolean) => {
      if (!quizDay) return;
      setQuizWrong((current) =>
        on
          ? current.includes(qIndex)
            ? current
            : [...current, qIndex]
          : current.filter((i) => i !== qIndex),
      );
      const response = await fetch(`/api/quiz/${quizDay}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "wrong", qIndex, on }),
      });
      if (!response.ok) {
        setQuizWrong((current) =>
          on ? current.filter((i) => i !== qIndex) : [...current, qIndex],
        );
      }
    },
    [quizDay],
  );

  useEffect(() => {
    if (!quizDay) return;
    let cancelled = false;
    fetch("/api/quiz")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.items)) return;
        const map: Record<string, boolean> = {};
        for (const item of data.items as {
          day: string;
          status: string;
        }[]) {
          map[item.day] = item.status === "done";
        }
        setQuizStatusMap(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [quizDay, quizDone]);

  async function toggleQuizDone() {
    if (!quizDay) return;
    const next = !quizDone;
    setQuizDone(next);
    const response = await fetch(`/api/quiz/${quizDay}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "status",
        status: next ? "done" : "pending",
      }),
    });
    if (!response.ok) setQuizDone(!next);
  }

  // 加载同文件夹文章，供左缘抽屉使用
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSiblingsOpen(false);
    });
    if (!article?.url?.startsWith("obsidian://")) {
      queueMicrotask(() => {
        if (cancelled) return;
        setSiblings([]);
        setSiblingFolder("");
      });
      return () => {
        cancelled = true;
      };
    }
    const relative = article.url.slice("obsidian://".length);
    const folder = relative.includes("/")
      ? relative.slice(0, relative.lastIndexOf("/"))
      : "";
    queueMicrotask(() => {
      if (!cancelled) setSiblingFolder(folder);
    });
    fetch(`/api/obsidian/library?folder=${encodeURIComponent(folder)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        setSiblings(
          Array.isArray(data?.files) ? (data.files as SiblingFile[]) : [],
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [article?.id, article?.url]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const editingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const locatedCitationRef = useRef("");

  // 加载文章
  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/articles/${articleId}`);
      if (res.ok) {
        const data = await res.json();
        setArticle(data);
      }
      setLoading(false);
    }
    load();
  }, [articleId]);

  // 选中文本监听
  useEffect(() => {
    function handleSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelection(null);
        return;
      }

      const text = sel.toString().trim();
      if (!text || text.length < 2) {
        setSelection(null);
        return;
      }

      // 编辑模式下不弹选中浮窗
      const anchor = sel.anchorNode;
      const anchorElement =
        anchor instanceof Element ? anchor : anchor?.parentElement;
      if (anchorElement?.closest("textarea, input")) {
        setSelection(null);
        return;
      }

      // 确保选中的是正文区域内的文本
      const range = sel.getRangeAt(0);
      if (!contentRef.current?.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      // 获取上下文
      const container = contentRef.current;
      const fullText = container.textContent || "";
      const selStart = getTextOffset(container, range);
      const start = Math.max(0, selStart - 100);
      const end = Math.min(fullText.length, selStart + text.length + 100);
      const context = fullText.substring(start, end);

      setSelection({
        x: rect.left + rect.width / 2,
        y: rect.top,
        text,
        context,
      });
    }

    document.addEventListener("selectionchange", handleSelection);
    return () =>
      document.removeEventListener("selectionchange", handleSelection);
  }, []);

  // 阅读进度追踪（节流保存）
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!article) return;

    const scrollElement = contentRef.current;
    if (!scrollElement) return;

    function handleScroll() {
      if (editingRef.current) return;
      const element = contentRef.current;
      if (!element) return;
      const scrollHeight = element.scrollHeight - element.clientHeight;
      const progress =
        scrollHeight > 0 ? (element.scrollTop / scrollHeight) * 100 : 0;

      if (progressTimer.current) clearTimeout(progressTimer.current);
      progressTimer.current = setTimeout(() => {
        fetch(`/api/articles/${articleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            readingProgress: Math.round(progress),
            lastReadAt: new Date().toISOString(),
          }),
        });
      }, 1000);
    }

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollElement.removeEventListener("scroll", handleScroll);
  }, [article, articleId]);

  // 高亮选中文本（保存位置信息：前后文锚点 + 字符偏移量）
  async function applyHighlight(text: string, color: string) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const prose =
      contentRef.current?.querySelector<HTMLElement>(".reader-prose");
    if (!prose || !prose.contains(range.commonAncestorContainer)) return;

    // 计算位置信息：前后文锚点 + 字符偏移量（以正文为基准，与回标恢复一致）
    const fullText = prose.textContent || "";
    const selStart = getTextOffset(prose, range);
    const prefix = fullText.substring(Math.max(0, selStart - 50), selStart);
    const suffix = fullText.substring(
      selStart + text.length,
      Math.min(fullText.length, selStart + text.length + 50),
    );

    // 安全包裹：按文本节点分段包裹，绝不做跨元素手术
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.nodeValue) nodes.push(node);
    }
    wrapOffsets(nodes, selStart, selStart + text.length, () => {
      const span = document.createElement("span");
      span.style.background = HIGHLIGHT_BG[color] || HIGHLIGHT_BG.yellow;
      span.style.borderRadius = "2px";
      span.style.padding = "0 2px";
      span.style.cursor = "pointer";
      span.className = "highlight-mark";
      span.dataset.color = color;
      return span;
    });
    window.getSelection()?.removeAllRanges();

    // 保存到数据库（含位置信息）
    const response = await fetch("/api/highlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        color,
        articleId,
        prefix,
        suffix,
        startOffset: selStart,
        endOffset: selStart + text.length,
      }),
    });
    if (response.ok) {
      const highlight = await response.json();
      setArticle((current) =>
        current
          ? { ...current, highlights: [...current.highlights, highlight] }
          : current,
      );
    }

    setSelection(null);
  }

  // 一键整理格式：AI 整理排版 → 走 PATCH 保存（vault 文章同步写回）→ 可撤销
  async function tidyArticle() {
    if (!article || tidying || editing) return;
    setTidying(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/articles/${articleId}/tidy`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "整理失败");
      const previous = article.content;
      const patch = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: data.content }),
      });
      if (!patch.ok) throw new Error("保存整理结果失败");
      setUndoContent(previous);
      setArticle((current) =>
        current ? { ...current, content: data.content } : current,
      );
      setFlashError(false);
      setSavedFlash("格式已整理并保存");
    } catch (error) {
      setFlashError(true);
      setSavedFlash(error instanceof Error ? error.message : "整理失败");
    } finally {
      setTidying(false);
    }
  }

  async function undoTidy() {
    if (!article || !undoContent) return;
    const previous = undoContent;
    setUndoContent(null);
    try {
      const patch = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: previous }),
      });
      if (!patch.ok) throw new Error("撤销失败");
      setArticle((current) =>
        current ? { ...current, content: previous } : current,
      );
      setFlashError(false);
      setSavedFlash("已撤销整理");
    } catch (error) {
      setFlashError(true);
      setSavedFlash(error instanceof Error ? error.message : "撤销失败");
    }
  }

  function openDesk(
    tab: AnnotationTab,
    text = "",
    context = "",
    question = "",
  ) {
    setDeskTab(tab);
    setDeskSelection(text ? { text, context } : null);
    setDeskQuestion(question);
    setDeskRequestKey((value) => value + 1);
    setDeskOpen(true);
    setSelection(null);
  }

  function handleDawnAgent(text: string, context: string) {
    openDesk("agent", text, context);
  }

  function handleSummarize() {
    openDesk(
      "agent",
      "",
      "",
      "请概括全文的核心观点，指出需要验证的前提，并给出三个可执行的下一步。",
    );
  }

  function handleNote(text: string, context: string) {
    openDesk("note", text, context);
  }

  function handleIngest(text: string, context: string) {
    openDesk("ingest", text, context);
  }

  function startEdit() {
    if (!article) return;
    dirtyRef.current = false;
    setSaveError(null);
    setSavedFlash(null);
    setEditing(true);
    editingRef.current = true;
    setSelection(null);
    setDeskOpen(false);
  }

  const cancelEdit = useCallback(() => {
    setEditing(false);
    editingRef.current = false;
    setSaveError(null);
  }, []);

  // 放弃编辑：有未保存修改时先确认，防误触丢失
  const discardEdit = useCallback(() => {
    if (dirtyRef.current && !window.confirm("有未保存的修改，确定放弃吗？"))
      return;
    dirtyRef.current = false;
    cancelEdit();
  }, [cancelEdit]);

  // 原位编辑结束：save=true 时把渲染 DOM 反向序列化回 Markdown 并保存
  async function finishEdit(save: boolean) {
    if (!save) {
      cancelEdit();
      return;
    }
    if (!article || saving) return;
    const prose =
      contentRef.current?.querySelector<HTMLElement>(".reader-prose");
    if (!prose) {
      cancelEdit();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const markdown = serializeProse(prose);
      const response = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: markdown }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "保存失败");
      }
      const fresh = await fetch(`/api/articles/${articleId}`).then((res) =>
        res.json(),
      );
      setArticle(fresh);
      dirtyRef.current = false;
      setEditing(false);
      editingRef.current = false;
      setSavedFlash(
        fresh.url?.startsWith("obsidian://")
          ? "已保存 · 已写回 Obsidian Vault"
          : "已保存",
      );
    } catch (error) {
      // 保存失败时留在编辑态，避免丢失修改
      setSaveError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editing) {
        event.preventDefault();
        discardEdit();
      } else if (wide) {
        event.preventDefault();
        setWide(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [discardEdit, editing, wide]);

  // 编辑态：标记 dirty + 关页前拦截，避免“改了但没存”
  useEffect(() => {
    if (!editing) return;
    const prose = contentRef.current?.querySelector(".reader-prose");
    const mark = () => {
      dirtyRef.current = true;
    };
    prose?.addEventListener("input", mark);
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      prose?.removeEventListener("input", mark);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [editing]);

  useEffect(() => {
    if (!savedFlash) return;
    // 有撤销可用时延长提示，给足后悔窗口
    const timer = setTimeout(
      () => setSavedFlash(null),
      undoContent ? 12000 : 2600,
    );
    return () => clearTimeout(timer);
  }, [savedFlash, undoContent]);

  // 表格操作反馈（插入行列、删除限制等）短暂停留后自动消失
  useEffect(() => {
    if (!editNotice) return;
    const timer = setTimeout(() => setEditNotice(null), 2400);
    return () => clearTimeout(timer);
  }, [editNotice]);

  const handleTableNotice = useCallback(
    (message: string, isError = false) => {
      setEditNotice(message);
      setEditNoticeError(isError);
    },
    [],
  );

  // 编辑态插入新表格：落在光标所在块之后，无光标时追加到文末
  function handleInsertTable() {
    const prose =
      contentRef.current?.querySelector<HTMLElement>(".reader-prose");
    if (!prose) return;
    insertTableAtSelection(prose);
    handleTableNotice("已插入空白表格，点击单元格即可输入");
  }

  // 加载后按锚点恢复正文标记：高亮 + 批注原文，让“哪里被标注过”一眼可见
  useEffect(() => {
    if (editing || !article) return;
    const prose =
      contentRef.current?.querySelector<HTMLElement>(".reader-prose");
    if (!prose) return;
    prose.querySelectorAll(".highlight-mark, .note-mark").forEach((el) => {
      el.replaceWith(...Array.from(el.childNodes));
    });
    prose.normalize();
    for (const highlight of article.highlights) {
      const located = locateQuote(prose, highlight.text, highlight.prefix);
      if (!located) continue;
      wrapOffsets(located.nodes, located.start, located.end, () => {
        const span = document.createElement("span");
        span.className = "highlight-mark";
        span.dataset.color = highlight.color;
        span.style.background =
          HIGHLIGHT_BG[highlight.color] || HIGHLIGHT_BG.yellow;
        span.style.borderRadius = "2px";
        span.style.padding = "0 2px";
        span.style.cursor = "pointer";
        return span;
      });
    }
    for (const note of article.notes) {
      const quote = note.quote || extractNoteQuote(note.content);
      if (!quote) continue;
      const located = locateQuote(prose, quote);
      if (!located) continue;
      wrapOffsets(located.nodes, located.start, located.end, () => {
        const span = document.createElement("span");
        span.className = "note-mark";
        span.title = "批注 · 点击打开标注台";
        return span;
      });
    }
  }, [article, editing]);

  useEffect(() => {
    if (editing) {
      locatedCitationRef.current = "";
      return;
    }
    if (!article || !initialCitation?.quote) return;
    const prose =
      contentRef.current?.querySelector<HTMLElement>(".reader-prose");
    if (!prose) return;
    const key = `${article.id}:${initialCitation.id}:${initialCitation.startOffset}`;
    if (
      locatedCitationRef.current === key &&
      prose.querySelector(".citation-focus-mark")
    ) {
      return;
    }
    prose.querySelectorAll(".citation-focus-mark").forEach((element) => {
      element.replaceWith(...Array.from(element.childNodes));
    });
    prose.normalize();
    locatedCitationRef.current = key;
    const located = locateCitationQuote(prose, initialCitation.quote);
    if (!located) {
      setFlashError(true);
      setSavedFlash(`没有在当前版本中找到来源 ${initialCitation.id}`);
      return;
    }
    wrapOffsets(located.nodes, located.start, located.end, () => {
      const span = document.createElement("span");
      span.className = "citation-focus-mark";
      span.dataset.citation = initialCitation.id;
      span.title = `知识库引用 ${initialCitation.id}`;
      return span;
    });
    const first = prose.querySelector<HTMLElement>(".citation-focus-mark");
    if (!first) return;
    setFlashError(false);
    setSavedFlash(`已定位到知识库来源 ${initialCitation.id}`);
    const frame = window.requestAnimationFrame(() => {
      first.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [article, editing, initialCitation]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="skeleton h-12 w-64 rounded-lg" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="empty-state">
          <p className="text-sm">文章不存在</p>
          <Link
            href="/reading"
            className="mt-3 text-xs text-[var(--color-accent-purple)] hover:underline"
          >
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ViewTransition
      enter={{
        "document-open": "document-forward",
        "nav-back": "document-back",
        default: "none",
      }}
      exit={{
        "document-open": "document-forward",
        "nav-back": "document-back",
        default: "none",
      }}
      default="none"
    >
      <div
        className={
          wide && !editing ? "reader-shell reader-shell--wide" : "reader-shell"
        }
      >
        {/* 阅读区域 */}
        <div className="reader-primary">
          {/* 顶部栏 */}
          <header className="reader-toolbar">
            <div className="reader-toolbar-crumb">
              <Link
                href="/reading"
                transitionTypes={["nav-back"]}
                className="reader-back"
                title="返回书架"
                onClick={(event) => {
                  if (
                    editing &&
                    dirtyRef.current &&
                    !window.confirm("有未保存的修改，确定不保存就离开吗？")
                  ) {
                    event.preventDefault();
                  }
                }}
              >
                <ArrowLeft aria-hidden="true" />
                书架
              </Link>
              {siblingFolder ? (
                <>
                  <span className="reader-divider">›</span>
                  <span className="reader-toolbar-folder">
                    {siblingFolder.split("/").pop()}
                  </span>
                </>
              ) : null}
              <span className="reader-divider">›</span>
              <h1>{article.title}</h1>
            </div>
            <div className="reader-toolbar-actions">
              <span className="reader-progress-copy">
                进度 {Math.round(article.readingProgress)}%
              </span>
              {quizDay && (
                <button
                  type="button"
                  onClick={() => void toggleQuizDone()}
                  className={
                    quizDone
                      ? "reader-tool-button reader-tool-button--quiz-done"
                      : "reader-tool-button"
                  }
                  title={
                    quizDone ? "取消完成标记" : "把这套题标记为已完成"
                  }
                >
                  {quizDone ? (
                    <CheckCircle2 aria-hidden="true" />
                  ) : (
                    <Circle aria-hidden="true" />
                  )}
                  {quizDone ? "已完成" : "标记完成"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setWide((current) => !current)}
                className={
                  wide
                    ? "reader-icon-button reader-icon-button--active"
                    : "reader-icon-button"
                }
                title={
                  wide
                    ? "退出全屏（ESC）"
                    : "全屏阅读（隐藏侧栏顶栏，ESC 退出）"
                }
                aria-label={wide ? "退出全屏" : "全屏阅读"}
              >
                {wide ? (
                  <Minimize2 aria-hidden="true" />
                ) : (
                  <Maximize2 aria-hidden="true" />
                )}
              </button>
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={() => void finishEdit(true)}
                    disabled={saving}
                    className="reader-tool-button reader-tool-button--active"
                  >
                    <Check aria-hidden="true" />
                    {saving ? "保存中…" : "完成"}
                  </button>
                  <button
                    type="button"
                    onClick={() => discardEdit()}
                    disabled={saving}
                    className="reader-icon-button"
                    title="放弃修改"
                    aria-label="放弃修改"
                  >
                    <X aria-hidden="true" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={startEdit}
                  className="reader-icon-button"
                  title="编辑"
                  aria-label="编辑"
                >
                  <Pencil aria-hidden="true" />
                </button>
              )}
              {!editing && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      downloadMarkdown(article.title, article.content ?? "");
                      setMdCopied(true);
                      window.setTimeout(() => setMdCopied(false), 1600);
                    }}
                    className={
                      mdCopied
                        ? "reader-icon-button reader-icon-button--done"
                        : "reader-icon-button"
                    }
                    title="生成 Markdown 文档"
                    aria-label="生成 Markdown 文档"
                  >
                    {mdCopied ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Download aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="reader-icon-button"
                    title="导出 PDF"
                    aria-label="导出 PDF"
                  >
                    <Printer aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={handleSummarize}
                    className="reader-icon-button"
                    title="总结全文"
                    aria-label="总结全文"
                  >
                    <Sparkles aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void tidyArticle()}
                    className="reader-icon-button"
                    title="一键整理格式（AI 整理排版，保存回原文件，可撤销）"
                    aria-label="一键整理格式"
                    disabled={tidying || editing}
                  >
                    {tidying ? (
                      <Loader2 className="ai-spinner" aria-hidden="true" />
                    ) : (
                      <Wand2 aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      deskOpen && deskTab === "note"
                        ? setDeskOpen(false)
                        : openDesk("note")
                    }
                    className={
                      deskOpen && deskTab === "note"
                        ? "reader-icon-button reader-icon-button--active"
                        : "reader-icon-button"
                    }
                    title="笔记"
                    aria-label="笔记"
                  >
                    <StickyNote aria-hidden="true" />
                    <span className="reader-icon-count">
                      {article.notes.length +
                        article.highlights.filter((item) => item.note).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      deskOpen && deskTab === "ingest"
                        ? setDeskOpen(false)
                        : openDesk("ingest")
                    }
                    className={
                      deskOpen && deskTab === "ingest"
                        ? "reader-icon-button reader-icon-button--active"
                        : "reader-icon-button"
                    }
                    title="入库"
                    aria-label="入库"
                  >
                    <Database aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(true)}
                    className="reader-icon-button reader-icon-button--danger"
                    title="删除这篇文档"
                    aria-label="删除这篇文档"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          </header>

          {/* 进度条 */}
          <div
            className="reader-top-progress"
            style={{ width: `${article.readingProgress}%` }}
          />

          {/* 左缘悬停：同文件夹文章抽屉 */}
          {article.url?.startsWith("obsidian://") && siblings.length > 0 && (
            <>
              <div
                className="reader-sibling-zone"
                onMouseEnter={() => setSiblingsOpen(true)}
                aria-hidden="true"
              />
              <aside
                className={
                  siblingsOpen
                    ? "reader-siblings reader-siblings--open"
                    : "reader-siblings"
                }
                onMouseLeave={() => setSiblingsOpen(false)}
                aria-label="同文件夹其他文章"
              >
                <div className="reader-siblings-head">
                  <p className="micro-label">SAME FOLDER</p>
                  <strong>
                    {siblingFolder.split("/").pop() || siblingFolder}
                  </strong>
                  <span>{siblings.length} 篇</span>
                </div>
                <div className="reader-siblings-list">
                  {siblings.map((file) => {
                    const day = quizDay
                      ? quizDayFromName(file.title) ??
                        quizDayFromName(file.path.split("/").pop() ?? "")
                      : null;
                    const done = day ? (quizStatusMap[day] ?? false) : null;
                    return file.articleId ? (
                      <Link
                        key={file.path}
                        href={`/reading/${file.articleId}`}
                        className={
                          `${file.articleId === article.id ? "active " : ""}${
                            done === true
                              ? "reader-siblings-quiz--done"
                              : done === false
                                ? "reader-siblings-quiz--todo"
                                : ""
                          }`
                        }
                      >
                        {done !== null && (
                          <i
                            className={
                              done
                                ? "reader-siblings-dot reader-siblings-dot--done"
                                : "reader-siblings-dot reader-siblings-dot--todo"
                            }
                          />
                        )}
                        <strong>{file.title}</strong>
                        <time>{formatDate(file.updatedAt)}</time>
                      </Link>
                    ) : (
                      <div className="reader-siblings-disabled" key={file.path}>
                        <strong>{file.title}</strong>
                        <span>同步中</span>
                      </div>
                    );
                  })}
                </div>
              </aside>
            </>
          )}

          {/* 正文 */}
          <div ref={contentRef} className="reader-scroll">
            {(editing || savedFlash || undoContent) && (
              <div
                className={
                  (saveError || (editing && editNotice && editNoticeError)) &&
                  editing
                    ? "reader-edit-hint reader-edit-hint--error"
                    : savedFlash && !editing
                      ? flashError
                        ? "reader-edit-hint reader-edit-hint--error"
                        : "reader-edit-hint reader-edit-hint--ok"
                      : "reader-edit-hint"
                }
                role="status"
              >
                {editing ? (
                  <>
                    <span className="reader-hint-text">
                      {saveError ||
                        editNotice ||
                        `原位编辑中 · 点顶部“完成”自动保存并回到预览 · ESC 放弃${article.url?.startsWith("obsidian://") ? " · 保存后写回 Obsidian Vault" : ""}`}
                    </span>
                    {!saveError && (
                      <button
                        type="button"
                        className="reader-hint-tool"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={handleInsertTable}
                        title="在光标位置插入空白表格"
                      >
                        <Table aria-hidden="true" /> 插入表格
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {savedFlash ?? "格式整理完成"}
                    {undoContent && !editing && (
                      <button
                        type="button"
                        className="reader-undo-btn"
                        onClick={() => void undoTidy()}
                      >
                        撤销
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            <article className="reader-article">
              <ViewTransition
                name={`document-${article.id}`}
                share="document-morph"
                default="none"
              >
                <header className="reader-article-intro">
                  <p className="micro-label">DEEP READING · SAVED LOCALLY</p>
                  <h1>{article.title}</h1>
                  <div className="reader-tags">
                    {article.tags.map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                </header>
              </ViewTransition>
              <MarkdownArticle
                key={editing ? "editing" : "preview"}
                content={article.content}
                editing={editing}
                articleId={articleId}
                quizDay={quizDay}
                quizWrong={quizWrong}
                onToggleWrong={(qIndex, on) => void toggleEmbedWrong(qIndex, on)}
                onMarkClick={(text) => openDesk("note", text)}
                onTableNotice={handleTableNotice}
              />
            </article>
          </div>
        </div>

        {deskOpen && (
          <AnnotationDesk
            key={`annotation-${deskRequestKey}`}
            articleId={articleId}
            articleTitle={article.title}
            articleContent={article.content}
            articleSource={article.source}
            articleUrl={article.url}
            notes={article.notes}
            highlights={article.highlights}
            activeTab={deskTab}
            selection={deskSelection}
            initialQuestion={deskQuestion}
            onTabChange={setDeskTab}
            onClose={() => setDeskOpen(false)}
            onNoteCreated={(note) =>
              setArticle((current) =>
                current
                  ? { ...current, notes: [note, ...current.notes] }
                  : current,
              )
            }
            onHighlightCreated={(highlight) =>
              setArticle((current) =>
                current
                  ? {
                      ...current,
                      highlights: [...current.highlights, highlight],
                    }
                  : current,
              )
            }
            onNoteDeleted={(id) =>
              setArticle((current) =>
                current
                  ? {
                      ...current,
                      notes: current.notes.filter((item) => item.id !== id),
                    }
                  : current,
              )
            }
            onHighlightDeleted={(id) =>
              setArticle((current) =>
                current
                  ? {
                      ...current,
                      highlights: current.highlights.filter(
                        (item) => item.id !== id,
                      ),
                    }
                  : current,
              )
            }
          />
        )}

        {/* 选中浮窗 */}
        <HighlightToolbar
          position={selection}
          onDawnAgent={handleDawnAgent}
          onHighlight={applyHighlight}
          onNote={handleNote}
          onIngest={handleIngest}
        />

        {pendingDelete && article && (
          <DeleteDocumentDialog
            doc={{ id: article.id, title: article.title, url: article.url }}
            onDeleted={() => router.push("/reading")}
            onClose={() => setPendingDelete(false)}
          />
        )}
      </div>
    </ViewTransition>
  );
}

const HIGHLIGHT_BG: Record<string, string> = {
  yellow: "rgba(250,204,21,0.3)",
  green: "rgba(52,211,153,0.3)",
  blue: "rgba(96,165,250,0.3)",
  pink: "rgba(244,114,182,0.3)",
};

// 从笔记内容里提取锚定原文：取开头第一段的引用行（理解记录的 > 块）
function extractNoteQuote(content: string): string {
  const quoted: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^>\s?(.*)$/);
    if (match) quoted.push(match[1]);
    else if (quoted.length) break;
  }
  return quoted.join("\n").trim();
}

// 按文本节点分段各自包裹：只做 splitText + 单节点包裹，
// 绝不做跨元素的 extractContents/surroundContents 手术，避免撕裂列表/段落结构
function wrapOffsets(
  nodes: Text[],
  start: number,
  end: number,
  makeSpan: () => HTMLElement,
) {
  let acc = 0;
  for (const node of nodes) {
    const len = node.nodeValue?.length ?? 0;
    const nodeStart = acc;
    const nodeEnd = acc + len;
    acc = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    if (to <= from || !node.parentNode) continue;
    if (to < len) node.splitText(to);
    const mid = from > 0 ? node.splitText(from) : node;
    const span = makeSpan();
    mid.parentNode?.insertBefore(span, mid);
    span.appendChild(mid);
  }
}

// 在正文里定位原文：精确匹配 → 前锚点消歧 → 空白容错回退
function locateQuote(
  prose: HTMLElement,
  quote: string,
  prefix?: string,
): { nodes: Text[]; start: number; end: number } | null {
  const target = quote.trim();
  if (!target) return null;
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let full = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.nodeValue) continue;
    nodes.push(node);
    full += node.nodeValue;
  }
  if (!full) return null;

  const candidates: Array<[number, number]> = [];
  for (let cursor = 0; ;) {
    const idx = full.indexOf(target, cursor);
    if (idx < 0) break;
    candidates.push([idx, idx + target.length]);
    cursor = idx + 1;
  }

  let chosen: [number, number] | null = null;
  if (candidates.length === 1) {
    chosen = candidates[0];
  } else if (candidates.length > 1 && prefix) {
    let best = -1;
    for (const [start] of candidates) {
      const pre = full.slice(Math.max(0, start - 50), start);
      let score = 0;
      for (let k = 1; k <= Math.min(pre.length, prefix.length); k += 1) {
        if (pre.slice(-k) === prefix.slice(-k)) score = k;
        else break;
      }
      if (score > best) {
        best = score;
        chosen = [start, start + target.length];
      }
    }
  } else if (candidates.length > 1) {
    chosen = candidates[0];
  }

  if (!chosen) {
    const mapToReal: number[] = [];
    let norm = "";
    for (let i = 0; i < full.length; i += 1) {
      const ch = full[i];
      if (/\s/.test(ch)) {
        if (norm && !norm.endsWith(" ")) {
          norm += " ";
          mapToReal.push(i);
        }
      } else {
        norm += ch;
        mapToReal.push(i);
      }
    }
    const nTarget = target.replace(/\s+/g, " ");
    const ni = norm.indexOf(nTarget);
    if (ni >= 0) {
      const start = mapToReal[ni];
      const end =
        mapToReal[Math.min(ni + nTarget.length - 1, mapToReal.length - 1)] + 1;
      chosen = [start, end];
    } else {
      // 再容错：忽略全部空白（选区跨行带来的换行在正文里不存在）
      const stripMap: number[] = [];
      let stripped = "";
      for (let i = 0; i < full.length; i += 1) {
        if (!/\s/.test(full[i])) {
          stripped += full[i];
          stripMap.push(i);
        }
      }
      const sTarget = target.replace(/\s+/g, "");
      const si = stripped.indexOf(sTarget);
      if (si < 0) return null;
      chosen = [
        stripMap[si],
        stripMap[Math.min(si + sTarget.length - 1, stripMap.length - 1)] + 1,
      ];
    }
  }
  return { nodes, start: chosen[0], end: chosen[1] };
}

function locateCitationQuote(prose: HTMLElement, markdownQuote: string) {
  const direct = locateQuote(prose, markdownQuote);
  if (direct) return direct;

  const preview = document.createElement("div");
  preview.innerHTML = renderMarkdown(markdownQuote);
  const visibleText = (preview.textContent ?? "").trim();
  const visible = locateQuote(prose, visibleText);
  if (visible) return visible;

  const blocks = Array.from(
    preview.querySelectorAll<HTMLElement>("h1,h2,h3,h4,p,li,blockquote,pre"),
  )
    .map((element) => (element.textContent ?? "").trim())
    .filter((text) => text.length >= 24)
    .sort((a, b) => b.length - a.length);
  for (const block of blocks) {
    const located = locateQuote(prose, block);
    if (located) return located;
  }
  return null;
}

function getTextOffset(container: Node, range: Range) {
  const leading = document.createRange();
  leading.selectNodeContents(container);
  leading.setEnd(range.startContainer, range.startOffset);
  return leading.toString().length;
}

function MarkdownArticle({
  content,
  editing = false,
  articleId = null,
  onMarkClick,
  onTableNotice,
  quizDay,
  quizWrong,
  onToggleWrong,
}: {
  content: string;
  editing?: boolean;
  articleId?: string | null;
  quizDay?: string | null;
  quizWrong?: number[];
  onToggleWrong?: (qIndex: number, on: boolean) => void;
  onMarkClick?: (text: string) => void;
  onTableNotice?: (message: string, isError?: boolean) => void;
}) {
  const router = useRouter();
  const [linkMap, setLinkMap] = useState<Record<string, string>>({});
  const proseRef = useRef<HTMLDivElement>(null);

  // 编辑态：为每个表格注入操作工具栏（增删行列 / 删除表格），退出编辑时清理
  useEffect(() => {
    if (!editing || !proseRef.current) return;
    const notify = onTableNotice ?? (() => undefined);
    return injectTableToolbars(proseRef.current, notify);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // 连排选项段落 → 逐行可勾选选项（checkbox 记录我的选择）
  useEffect(() => {
    const el = proseRef.current;
    if (editing || !el) return;
    enhanceQuizSections(el, articleId);
    const onChange = (event: Event) =>
      handleQuizCheckChange(event.target, articleId);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [content, linkMap, editing, articleId]);

  // 题集文章：为每个内嵌选项块挂「收录错题」开关（与题库机错题本同步）
  useEffect(() => {
    const el = proseRef.current;
    if (editing || !el || !quizDay) return;
    let cancelled = false;
    fetch(`/api/quiz/${quizDay}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.set) return;
        const questions = data.set.questions as {
          index: number;
          options: { key: string; text: string }[];
        }[];
        const blocks = Array.from(
          el.querySelectorAll<HTMLElement>(".quiz-embed-options"),
        );
        for (const block of blocks) {
          if (block.querySelector(".quiz-embed-wrong-btn")) continue;
          const sig = domOptionsSignature(block);
          const match = questions.find(
            (question) =>
              question.options.length > 0 &&
              optionsSignature(question.options) === sig,
          );
          if (!match) continue;
          block.dataset.qIndex = String(match.index);
          const on = (quizWrong ?? []).includes(match.index);
          const button = createWrongButton(on);
          block.prepend(button);
        }
      })
      .catch(() => undefined);
    const onClick = (event: Event) => {
      const button = (event.target as HTMLElement | null)?.closest?.(
        ".quiz-embed-wrong-btn",
      ) as HTMLButtonElement | null;
      if (!button) return;
      const block = button.closest<HTMLElement>(".quiz-embed-options");
      const qIndex = Number(block?.dataset.qIndex ?? "");
      if (!block || Number.isNaN(qIndex)) return;
      const on = !button.classList.contains("quiz-embed-wrong-btn--on");
      button.className = on
        ? "quiz-embed-wrong-btn quiz-embed-wrong-btn--on"
        : "quiz-embed-wrong-btn";
      button.dataset.label = on ? "已收录错题" : "收录错题";
      onToggleWrong?.(qIndex, on);
    };
    el.addEventListener("click", onClick);
    return () => {
      cancelled = true;
      el.removeEventListener("click", onClick);
    };
  }, [content, linkMap, editing, quizDay, quizWrong, onToggleWrong]);

  // 渲染后批量把文内链接解析为真实 /reading/<id> href，点击零延迟
  // 编辑态跳过：链接本就不可点，且异步回填会重绘 innerHTML，冲掉正在编辑的 DOM
  useEffect(() => {
    if (editing) return;
    const targets = extractLinkTargets(content);
    if (targets.length === 0) return;
    let cancelled = false;
    fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.map)
          setLinkMap(data.map as Record<string, string>);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [content, editing]);

  const blocks = splitMermaidBlocks(content);
  return (
    <div
      ref={proseRef}
      className={
        editing ? "reader-prose reader-prose--editing" : "reader-prose"
      }
      contentEditable={editing || undefined}
      suppressContentEditableWarning
      spellCheck={false}
      onClick={(event) => {
        if (editing) {
          // 编辑态下阻止链接跳转与复制按钮，点击仅用于放置光标
          event.preventDefault();
          return;
        }
        const markEl = (event.target as HTMLElement).closest<HTMLElement>(
          ".note-mark, .highlight-mark",
        );
        if (markEl) {
          // 点击高亮/批注标记：打开标注台并以该段文字为当前选择
          const text = (markEl.textContent ?? "").trim();
          if (text) onMarkClick?.(text);
          return;
        }
        handleProseClick(event);
        void handleResolveClick(event, router);
      }}
    >
      {blocks.map((block, index) =>
        block.type === "mermaid" ? (
          <MermaidDiagram source={block.content} key={`mermaid-${index}`} />
        ) : (
          <div
            className="reader-markdown-fragment"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(block.content, linkMap),
            }}
            key={`markdown-${index}`}
          />
        ),
      )}
    </div>
  );
}

/** 提取文内所有 vault 链接目标（wikilink / 嵌入 / md 链接），供批量解析 */
function extractLinkTargets(md: string): string[] {
  const targets = new Set<string>();
  for (const match of md.matchAll(
    /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g,
  )) {
    const target = match[1].trim();
    if (target) targets.add(target);
  }
  for (const match of md.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const target = match[1].trim();
    if (target && !/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(target))
      targets.add(target);
  }
  for (const match of md.matchAll(/(!?)\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    if (match[1] === "!") continue; // 图片不算链接
    const href = match[3].replace(/^<|>$/g, "").replace(/\.md$/i, "").trim();
    if (href && !/^https?:\/\//i.test(href)) targets.add(href);
  }
  return [...targets].slice(0, 80);
}

function handleProseClick(event: ReactMouseEvent<HTMLDivElement>) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    ".code-copy-btn",
  );
  if (!button) return;
  const code = button.closest("pre")?.querySelector("code");
  const text = code?.textContent ?? "";
  void copyText(text).then((ok) => {
    if (!ok) return;
    button.classList.add("code-copy-btn--done");
    button.textContent = "已复制";
    window.setTimeout(() => {
      button.classList.remove("code-copy-btn--done");
      button.textContent = "复制";
    }, 1600);
  });
}

async function handleResolveClick(
  event: ReactMouseEvent<HTMLDivElement>,
  router: { push: (href: string) => void },
) {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
    "a[data-resolve]",
  );
  if (!link) return;
  // 渲染时已解析为 /reading/<id> 的链接走默认导航
  if (!(link.getAttribute("href") ?? "").includes("?search=")) return;
  event.preventDefault();
  const target = link.getAttribute("data-resolve") ?? "";
  try {
    const response = await fetch(
      `/api/resolve?target=${encodeURIComponent(target)}`,
    );
    if (response.ok) {
      const data = await response.json();
      if (data?.id) {
        router.push(`/reading/${data.id}`);
        return;
      }
    }
  } catch {
    // 解析失败回退到书架搜索
  }
  router.push(link.getAttribute("href") ?? "/reading");
}

function downloadMarkdown(title: string, content: string) {
  const safeName =
    (title || "untitled").replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
  const blob = new Blob([content], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 降级到 execCommand
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function splitMermaidBlocks(markdown: string) {
  const blocks: Array<{ type: "markdown" | "mermaid"; content: string }> = [];
  const pattern = /```[ \t]*mermaid[ \t]*\n([\s\S]*?)```/gi;
  let cursor = 0;

  for (const match of markdown.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor)
      blocks.push({ type: "markdown", content: markdown.slice(cursor, start) });
    blocks.push({ type: "mermaid", content: match[1] });
    cursor = start + match[0].length;
  }

  if (cursor < markdown.length)
    blocks.push({ type: "markdown", content: markdown.slice(cursor) });
  return blocks.length
    ? blocks
    : [{ type: "markdown" as const, content: markdown }];
}

/** 覆盖阅读场景常用块级语法，并在插入 DOM 前统一转义原始内容。 */
type LinkMap = Record<string, string>;

function renderMarkdown(md: string, linkMap: LinkMap = {}): string {
  if (!md) return "";

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    output.push(`<p>${renderInline(paragraph.join(" "), linkMap)}</p>`);
    paragraph = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const language = trimmed
        .slice(3)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "");
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      output.push(
        `<pre${language ? ` data-language="${language}"` : ""}><button type="button" class="code-copy-btn" aria-label="复制代码">复制</button><code>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const isRelated = /相关(笔记|文档|链接|资料)|关联(文档|笔记|链接)/.test(
        heading[2],
      );
      if (isRelated) {
        // 前面的 <hr /> 分隔线一并标记，打印时随小节隐藏
        for (let i = output.length - 1; i >= 0; i -= 1) {
          if (output[i] === "<hr />") {
            output[i] = '<hr class="reader-related-hr" />';
            break;
          }
          if (output[i].trim()) break;
        }
      }
      output.push(
        `<h${level}${isRelated ? ' class="reader-related-heading"' : ""}>${renderInline(heading[2], linkMap)}</h${level}>`,
      );
      continue;
    }

    if (
      index + 1 < lines.length &&
      trimmed.includes("|") &&
      isTableSeparator(lines[index + 1])
    ) {
      flushParagraph();
      const headers = tableCells(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes("|")
      ) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      output.push(
        `<div class="reader-table-wrap"><table><thead><tr>${headers
          .map((cell) => `<th>${renderInline(cell, linkMap)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${headers
                .map(
                  (_, cellIndex) =>
                    `<td>${renderInline(row[cellIndex] || "", linkMap)}</td>`,
                )
                .join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      const callout = quote[0]?.match(/^\[!([a-z-]+)\]\s*(.*)$/i);
      if (callout) {
        const type = callout[1].toLowerCase();
        const label = calloutLabel(type);
        const body = [callout[2], ...quote.slice(1)].filter(Boolean).join(" ");
        output.push(
          `<aside class="reader-callout reader-callout--${escapeHtml(type)}"><strong><span></span>${label}</strong><p>${renderInline(body, linkMap)}</p></aside>`,
        );
      } else {
        output.push(
          `<blockquote class="reader-quote">${renderInline(quote.join(" "), linkMap)}</blockquote>`,
        );
      }
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const listTag = ordered ? "ol" : "ul";
      const items: string[] = [];
      const itemPattern = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const raw = lines[index];
        const item = raw.trim().match(itemPattern);
        if (item) {
          items.push(item[1]);
          index += 1;
          continue;
        }
        // 缩进行视为上一个列表项的续行（如长代码折行）
        const continuation = raw.match(/^(?:\s{2,}|\t)(\S.*)$/);
        if (continuation && items.length > 0) {
          items[items.length - 1] += ` ${continuation[1].trim()}`;
          index += 1;
          continue;
        }
        // 松散列表：空行后仍是同级列表项则不中断
        if (!raw.trim() && index + 1 < lines.length) {
          const next = lines[index + 1];
          if (next.trim().match(itemPattern) || /^(?:\s{2,}|\t)\S/.test(next)) {
            index += 1;
            continue;
          }
        }
        break;
      }
      index -= 1;
      output.push(
        `<${listTag}>${items.map((text) => renderListItem(text, linkMap)).join("")}</${listTag}>`,
      );
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph();
      output.push("<hr />");
      continue;
    }

    if (/^<details\b/i.test(trimmed)) {
      flushParagraph();
      const chunk: string[] = [line];
      let closed = /<\/details>/i.test(trimmed);
      while (!closed && index + 1 < lines.length) {
        index += 1;
        chunk.push(lines[index]);
        closed = /<\/details>/i.test(lines[index]);
      }
      output.push(renderDetailsBlock(chunk.join("\n"), linkMap));
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return output.join("\n");
}

/** <details>/<summary> 折叠块：默认收起，点击 summary 展开 */
function renderDetailsBlock(source: string, linkMap: LinkMap = {}): string {
  const inner = source
    .replace(/<details[^>]*>/gi, "")
    .replace(/<\/details>/gi, "");
  const summaryMatch = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  const summary = summaryMatch
    ? summaryMatch[1].replace(/<[^>]+>/g, "").trim()
    : "展开详情";
  const bodySource = summaryMatch ? inner.replace(summaryMatch[0], "") : inner;
  const body = renderMarkdown(bodySource, linkMap);
  return `<details class="reader-details"><summary>${escapeHtml(summary)}</summary><div class="reader-details-body">${body}</div></details>`;
}

function renderListItem(text: string, linkMap: LinkMap = {}): string {
  const task = text.match(/^\[([ xX])\]\s*(.*)$/);
  if (!task) return `<li>${renderInline(text, linkMap)}</li>`;
  const done = task[1] !== " ";
  return `<li class="reader-task"><span class="reader-task-box${done ? " reader-task-box--done" : ""}" aria-hidden="true">${done ? "✓" : ""}</span>${renderInline(task[2], linkMap)}</li>`;
}

function imageTag(src: string, alt: string): string {
  const cleanSrc = src.trim().replace(/^\.?\//, "");
  const url = /^https?:\/\//i.test(cleanSrc)
    ? cleanSrc
    : `/api/obsidian/asset?path=${encodeURIComponent(cleanSrc)}`;
  const label = alt.trim() || cleanSrc.split("/").pop() || "image";
  return `<img class="reader-img" loading="lazy" src="${escapeHtml(url)}" alt="${escapeHtml(label)}" />`;
}

function vaultLinkHref(
  target: string,
  label: string,
  linkMap: LinkMap,
): string {
  const id = linkMap[target];
  return id ? `/reading/${id}` : `/reading?search=${encodeURIComponent(label)}`;
}

function renderInline(value: string, linkMap: LinkMap = {}): string {
  const codeFragments: string[] = [];
  const wikiFragments: string[] = [];
  const embedFragments: string[] = [];
  const brFragments: string[] = [];
  let output = value.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const index = codeFragments.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return `\u0000CODE${index}\u0000`;
  });

  // 表格单元格/行内换行 <br> / <br/> / <br />，转义前占位保护
  output = output.replace(/<br\s*\/?>/gi, () => {
    const index = brFragments.push("<br />") - 1;
    return `\u0000BR${index}\u0000`;
  });

  // Markdown 图片 ![alt](src)
  output = output.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, alt: string, src: string) => {
      const index = embedFragments.push(imageTag(src.split(/\s+/)[0], alt)) - 1;
      return `\u0000EMB${index}\u0000`;
    },
  );

  // Obsidian 嵌入 ![[target]]
  output = output.replace(/!\[\[([^\]]+)\]\]/g, (_match, target: string) => {
    const clean = target.trim();
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(clean)) {
      const index =
        embedFragments.push(
          imageTag(
            clean,
            clean
              .split("/")
              .pop()
              ?.replace(/\.[^.]+$/, "") || clean,
          ),
        ) - 1;
      return `\u0000EMB${index}\u0000`;
    }
    const label = clean.split("/").pop() || clean;
    const index =
      embedFragments.push(
        `<a class="reader-wikilink" data-resolve="${escapeHtml(clean)}" href="${escapeHtml(vaultLinkHref(clean, label, linkMap))}">${escapeHtml(label)}</a>`,
      ) - 1;
    return `\u0000EMB${index}\u0000`;
  });

  output = output.replace(
    /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, alias?: string) => {
      const label = (alias || target.split("/").pop() || target).trim();
      const resolvedTarget = target.trim();
      const index =
        wikiFragments.push(
          `<a class="reader-wikilink" data-resolve="${escapeHtml(resolvedTarget)}" href="${escapeHtml(vaultLinkHref(resolvedTarget, label, linkMap))}">${escapeHtml(label)}</a>`,
        ) - 1;
      return `\u0000WIKI${index}\u0000`;
    },
  );

  // 普通 Markdown 链接 [text](href)
  output = output.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, text: string, href: string) => {
      const index = /^https?:\/\//i.test(href)
        ? embedFragments.push(
            `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`,
          ) - 1
        : (() => {
            const target = href
              .replace(/^<|>$/g, "")
              .replace(/\.md$/i, "")
              .trim();
            return (
              embedFragments.push(
                `<a class="reader-wikilink" data-resolve="${escapeHtml(target)}" href="${escapeHtml(vaultLinkHref(target, text, linkMap))}">${escapeHtml(text)}</a>`,
              ) - 1
            );
          })();
      return `\u0000EMB${index}\u0000`;
    },
  );

  output = escapeHtml(output)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>");

  return output
    .replace(
      /\u0000CODE(\d+)\u0000/g,
      (_match, index: string) => codeFragments[Number(index)],
    )
    .replace(
      /\u0000BR(\d+)\u0000/g,
      (_match, index: string) => brFragments[Number(index)],
    )
    .replace(
      /\u0000WIKI(\d+)\u0000/g,
      (_match, index: string) => wikiFragments[Number(index)],
    )
    .replace(
      /\u0000EMB(\d+)\u0000/g,
      (_match, index: string) => embedFragments[Number(index)],
    );
}

function calloutLabel(type: string) {
  const labels: Record<string, string> = {
    abstract: "摘要",
    summary: "摘要",
    tip: "提示",
    info: "信息",
    note: "笔记",
    warning: "注意",
    danger: "风险",
    example: "示例",
    quote: "引用",
  };
  return labels[type] || "补充说明";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

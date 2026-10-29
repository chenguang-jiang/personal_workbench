"use client";

import {
  memo,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  ViewTransition,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AnnotationDesk, type AnnotationTab } from "./AnnotationDesk";
import { EditToolbar } from "./EditToolbar";
import { HighlightToolbar, type SelectionPosition } from "./HighlightToolbar";
import { MermaidDiagram } from "./MermaidDiagram";
import { ReaderAiChat, type AiChatSelection } from "./ReaderAiChat";
import {
  ArrowLeft,
  BotMessageSquare,
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
  Share2,
  Sparkles,
  Star,
  StickyNote,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { renderMarkdown, splitMermaidBlocks, type RenderOptions } from "@/lib/reader-markdown";
import { serializeProse } from "@/lib/serialize-markdown";
import { useUiPrefs } from "@/lib/ui-prefs";
import {
  injectTableToolbars,
  insertMermaidAtSelection,
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
import { ShareDialog } from "./ShareDialog";
import {
  ArticleOutline,
  ReaderTuner,
  useReaderPrefs,
  type ReaderFont,
  type ReaderSize,
} from "./ArticleChrome";
import {
  articleOrigin,
  articleStamp,
  extractArticleOutline,
  readingMinutes,
} from "@/lib/article-outline";

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
  contentVersion: number;
  id: string;
  title: string;
  content: string;
  tags: string[];
  source?: string | null;
  url?: string | null;
  path?: string | null;
  updatedAt?: string;
  readingProgress: number;
  favoritedAt?: string | null;
  highlights: Highlight[];
  notes: Note[];
}

export function Reader({
  articleId,
  initialArticle,
  initialCitation,
  initialEditing = false,
  readOnly = false,
}: {
  readOnly?: boolean;
  articleId: string;
  initialArticle: ReaderArticle;
  /** 打开即进入原位编辑态（书架「新建文章」跳转用） */
  initialEditing?: boolean;
  initialCitation?: {
    id: string;
    quote: string;
    startOffset: number;
    endOffset: number;
  } | null;
}) {
  const [article, setArticle] = useState<ReaderArticle | null>(initialArticle);
  // 实时阅读进度（滚动时本地更新，节流写库）；打开文章时用它恢复上次位置
  const [progress, setProgress] = useState(initialArticle.readingProgress);
  // MarkdownArticle 每次重写正文 DOM（如链接解析回填）后自增，驱动高亮/批注标记重新挂载
  const [renderTick, setRenderTick] = useState(0);
  const [selection, setSelection] = useState<SelectionPosition | null>(null);
  const [deskOpen, setDeskOpen] = useState(false);
  const [deskTab, setDeskTab] = useState<AnnotationTab>("note");
  const [deskSelection, setDeskSelection] = useState<{
    text: string;
    context: string;
  } | null>(null);
  const [deskRequestKey, setDeskRequestKey] = useState(0);
  // AI 对话面板：selection/question 只在打开瞬间取值，面板内部自成状态
  const [aiOpen, setAiOpen] = useState(false);
  const [aiChatSelection, setAiChatSelection] = useState<AiChatSelection>(null);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiRequestKey, setAiRequestKey] = useState(0);
  const [editing, setEditing] = useState(initialEditing);
  const [saving, setSaving] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [undoContent, setUndoContent] = useState<string | null>(null);
  const [flashError, setFlashError] = useState(false);
  const [wide, setWide] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [siblings, setSiblings] = useState<SiblingFile[]>([]);
  const [siblingFolder, setSiblingFolder] = useState("");
  const [siblingsOpen, setSiblingsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const [editNoticeError, setEditNoticeError] = useState(false);
  // 未保存修改（dirtyRef 的可见镜像，驱动提示条上的状态点）
  const [dirty, setDirty] = useState(false);
  const router = useRouter();
  // 插入流程图时按当前主题/强调色渲染，与阅读视图一致
  const { theme, accent } = useUiPrefs();
  const { font, size, setFont, setSize } = useReaderPrefs();
  const [activeHeading, setActiveHeading] = useState("");

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
      }).catch(() => null);
      if (!response?.ok) {
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
  const editingRef = useRef(initialEditing);
  const contentRef = useRef<HTMLDivElement>(null);
  const locatedCitationRef = useRef("");

  // 选中文本监听
  useEffect(() => {
    let frame = 0;
    function scheduleSelection() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        handleSelection();
      });
    }
    function handleSelection() {
      // 编辑态（contentEditable）下不弹选中浮窗，避免把高亮写进正在编辑的 DOM
      if (editingRef.current) {
        setSelection(null);
        return;
      }
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

    document.addEventListener("selectionchange", scheduleSelection);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", scheduleSelection);
    };
  }, []);

  // 阅读进度追踪：滚动时本地更新进度条，停顿 1 秒后写库；卸载时清理定时器
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasArticle = Boolean(article);
  useEffect(() => {
    const scrollElement = contentRef.current;
    if (!hasArticle || !scrollElement) return;
    let frame = 0;

    function handleScroll() {
      if (editingRef.current || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const element = contentRef.current;
        if (!element) return;
        const scrollHeight = element.scrollHeight - element.clientHeight;
        const next =
          scrollHeight > 0 ? Math.round((element.scrollTop / scrollHeight) * 100) : 0;
        setProgress(next);
        if (progressTimer.current) clearTimeout(progressTimer.current);
        // 云端只读模式同样写进度（书架“接着读”依赖它）；只读限制的是正文编辑，接口侧会拦下其他字段
        progressTimer.current = setTimeout(() => {
          fetch(`/api/articles/${articleId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              readingProgress: next,
              lastReadAt: new Date().toISOString(),
            }),
          }).catch(() => undefined); // 进度属于尽力而为，失败不打扰阅读
        }, 1000);
      });
    }

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      if (progressTimer.current) clearTimeout(progressTimer.current);
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [hasArticle, articleId]);

  // 打开文章时回到上次读到的位置（来自知识库引用定位时以引用为准）
  const restoredProgressRef = useRef(false);
  useEffect(() => {
    if (restoredProgressRef.current || initialCitation?.quote) return;
    restoredProgressRef.current = true;
    const startAt = initialArticle.readingProgress;
    if (startAt < RESTORE_PROGRESS_MIN || startAt > RESTORE_PROGRESS_MAX) return;
    const frame = window.requestAnimationFrame(() => {
      const element = contentRef.current;
      if (!element) return;
      element.scrollTop = ((element.scrollHeight - element.clientHeight) * startAt) / 100;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialArticle.readingProgress, initialCitation?.quote]);

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
    const rawStart = getTextOffset(prose, range);
    const rawEnd = getTextOffset(prose, range, "end");
    // text 已 trim：把起止收缩到真实可见文字上，避免包裹偏移
    const raw = fullText.substring(rawStart, rawEnd);
    const selStart = rawStart + (raw.length - raw.trimStart().length);
    const selEnd = rawEnd - (raw.length - raw.trimEnd().length);
    const prefix = fullText.substring(Math.max(0, selStart - 50), selStart);
    const suffix = fullText.substring(selEnd, Math.min(fullText.length, selEnd + 50));

    // 安全包裹：按文本节点分段包裹，绝不做跨元素手术
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.nodeValue) nodes.push(node);
    }
    const pending: HTMLElement[] = [];
    wrapOffsets(nodes, selStart, selEnd, () => {
      const span = createHighlightSpan(color);
      span.dataset.pending = "true";
      pending.push(span);
      return span;
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);

    // 保存到数据库（含位置信息）；失败则撤掉乐观标记并提示
    try {
      const response = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fullText.substring(selStart, selEnd),
          color,
          articleId,
          prefix,
          suffix,
          startOffset: selStart,
          endOffset: selEnd,
        }),
      });
      if (!response.ok) throw new Error("highlight-failed");
      const highlight = await response.json();
      pending.forEach((span) => delete span.dataset.pending);
      setArticle((current) =>
        current
          ? { ...current, highlights: [...current.highlights, highlight] }
          : current,
      );
    } catch {
      pending.forEach((span) => span.replaceWith(...Array.from(span.childNodes)));
      prose.normalize();
      setFlashError(true);
      setSavedFlash("高亮没有保存成功，请重试");
    }
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
    try {
      const patch = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: previous }),
      });
      if (!patch.ok) throw new Error("撤销失败");
      setUndoContent(null);
      setArticle((current) =>
        current ? { ...current, content: previous } : current,
      );
      setFlashError(false);
      setSavedFlash("已撤销修改");
    } catch (error) {
      setFlashError(true);
      setSavedFlash(error instanceof Error ? error.message : "撤销失败");
    }
  }

  // 收藏切换：乐观更新，失败回滚
  async function toggleFavorite() {
    if (!article) return;
    const previous = article.favoritedAt ?? null;
    setArticle((current) =>
      current
        ? {
            ...current,
            favoritedAt: previous ? null : new Date().toISOString(),
          }
        : current,
    );
    try {
      const response = await fetch(`/api/articles/${articleId}/favorite`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("favorite-failed");
      const data = await response.json();
      setArticle((current) =>
        current ? { ...current, favoritedAt: data.favoritedAt } : current,
      );
      setFlashError(false);
      setSavedFlash(data.favorited ? "已加入收藏夹" : "已从收藏夹移除");
    } catch {
      setArticle((current) => ({ ...current!, favoritedAt: previous }));
      setFlashError(true);
      setSavedFlash("收藏状态没有保存成功，请重试");
    }
  }

  function openDesk(tab: AnnotationTab, text = "", context = "") {
    setDeskTab(tab);
    setDeskSelection(text ? { text, context } : null);
    setDeskRequestKey((value) => value + 1);
    setDeskOpen(true);
    setSelection(null);
  }

  // 点击高亮/批注标记：打开标注台并以该段文字为当前选择（稳定引用，避免正文重渲染）
  const handleMarkClick = useCallback((text: string) => {
    setDeskTab("note");
    setDeskSelection(text ? { text, context: "" } : null);
    setDeskRequestKey((value) => value + 1);
    setDeskOpen(true);
    setSelection(null);
  }, []);

  const handleArticleRendered = useCallback(() => {
    setRenderTick((tick) => tick + 1);
  }, []);

  function handleSummarize() {
    openAiChat(
      "",
      "",
      "请概括全文的核心观点，指出需要验证的前提，并给出三个可执行的下一步。",
    );
  }

  // AI 对话：selection/question 只在打开瞬间传入，面板内部自成会话状态
  function openAiChat(text = "", context = "", question = "") {
    setAiChatSelection(text ? { text, context } : null);
    setAiQuestion(question);
    setAiRequestKey((value) => value + 1);
    setAiOpen(true);
    setSelection(null);
    // 清掉原生选区：否则下一次 selectionchange 会让选区工具条再弹出来
    window.getSelection()?.removeAllRanges();
  }

  // 应用 AI 修改稿：走 PATCH 保存（vault 文章同步写回），旧文存入撤销快照
  async function applyAiEdit(content: string) {
    if (!article) return;
    const previous = article.content;
    const response = await fetch(`/api/articles/${articleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error("保存 AI 修改失败");
    setUndoContent(previous);
    setArticle((current) =>
      current ? { ...current, content } : current,
    );
    setFlashError(false);
    setSavedFlash("AI 修改已应用");
  }

  // 选中加粗：把渲染选区映射回 Markdown 源码，包裹 ** 后保存（可撤销）
  async function applyBold() {
    if (!article || editing) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const prose =
      contentRef.current?.querySelector<HTMLElement>(".reader-prose");
    if (!prose || !prose.contains(range.commonAncestorContainer)) return;

    // 代码块/表格/图表/链接里加粗会破坏结构，直接拒绝
    const anchorEl =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    if (anchorEl?.closest("pre, code, table, .mermaid-diagram, a, mark")) {
      setFlashError(true);
      setSavedFlash("代码块、表格和链接里不支持加粗");
      return;
    }

    const fullText = prose.textContent ?? "";
    const rawStart = getTextOffset(prose, range);
    const rawEnd = getTextOffset(prose, range, "end");
    const selected = fullText.slice(rawStart, rawEnd).trim();
    if (!selected) return;

    const next = boldInSource(article.content, selected);
    if (!next) {
      setFlashError(true);
      setSavedFlash("未能在原文中定位选中的文字，试着选短一点");
      return;
    }
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    try {
      await applyAiEdit(next.content);
      setSavedFlash(next.unbolded ? "已取消加粗" : "已加粗并保存");
    } catch (error) {
      setFlashError(true);
      setSavedFlash(error instanceof Error ? error.message : "加粗保存失败");
    }
  }

  function handleAskAi(text: string, context: string) {
    openAiChat(text, context);
  }

  function handleNote(text: string, context: string) {
    openDesk("note", text, context);
  }

  function handleIngest(text: string, context: string) {
    openDesk("ingest", text, context);
  }

  function startEdit() {
    if (!article) return;
    // 手动编辑后旧的“撤销整理”快照已失效，继续保留会把手动修改一并覆盖
    setUndoContent(null);
    dirtyRef.current = false;
    setDirty(false);
    setSaveError(null);
    setSavedFlash(null);
    setEditing(true);
    editingRef.current = true;
    setSelection(null);
    setDeskOpen(false);
    setAiOpen(false);
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
    setDirty(false);
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
      const response = await fetch(readOnly ? "/api/knowledge/edit" : `/api/articles/${articleId}`, {
        method: readOnly ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(readOnly ? { articleId, contentVersion: article.contentVersion } : {}), content: markdown }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "保存失败");
      }
      const freshResponse = await fetch(`/api/articles/${articleId}`);
      if (!freshResponse.ok) throw new Error("已保存，但重新加载失败，请刷新页面");
      const fresh = await freshResponse.json();
      setArticle(fresh);
      dirtyRef.current = false;
      setDirty(false);
      setEditing(false);
      editingRef.current = false;
      setSavedFlash(
        fresh.url?.startsWith("obsidian://")
          ? readOnly ? "已保存到云端 · 旧版已备份" : "已保存 · 已写回 Obsidian Vault"
          : "已保存",
      );
    } catch (error) {
      // 保存失败时留在编辑态，避免丢失修改
      setSaveError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  // 用 ref 持有最新的 finishEdit，⌘/Ctrl+S 保存时不必让键盘监听随每次渲染重挂
  const finishEditRef = useRef(finishEdit);
  useEffect(() => {
    finishEditRef.current = finishEdit;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // ⌘/Ctrl+S：编辑态下保存并屏蔽浏览器“保存网页”对话框
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        if (editingRef.current) {
          event.preventDefault();
          void finishEditRef.current(true);
        }
        return;
      }
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

  // 新建跳转：进编辑态后把光标直接放进正文，落地即可输入
  useEffect(() => {
    if (!initialEditing) return;
    contentRef.current?.querySelector<HTMLElement>(".reader-prose")?.focus();
  }, [initialEditing]);

  // 编辑态：标记 dirty + 关页前拦截，避免“改了但没存”
  useEffect(() => {
    if (!editing) return;
    const prose = contentRef.current?.querySelector(".reader-prose");
    const mark = (event: Event) => {
      // Mermaid 源码编辑器里的输入只是草稿，未「应用」前不算正文修改
      if ((event.target as HTMLElement | null)?.closest?.(".mermaid-diagram__editor")) return;
      dirtyRef.current = true;
      setDirty(true);
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

  // 编辑态插入流程图：figure 立即渲染预览，保存后升级为可交互的完整图组件
  function handleInsertMermaid() {
    const prose =
      contentRef.current?.querySelector<HTMLElement>(".reader-prose");
    if (!prose) return;
    void insertMermaidAtSelection(prose, theme, accent);
    handleTableNotice("已插入流程图 · 保存后可缩放、全屏与编辑源码");
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
        const span = createHighlightSpan(highlight.color);
        span.dataset.highlightId = highlight.id;
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
  }, [article, editing, renderTick]);

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
  }, [article, editing, initialCitation, renderTick]);

  const outline = useMemo(
    () => extractArticleOutline(article?.content ?? ""),
    [article?.content],
  );
  const minutes = useMemo(
    () => readingMinutes(article?.content ?? ""),
    [article?.content],
  );

  useEffect(() => {
    const root = contentRef.current;
    if (!root || editing || outline.length === 0) return;
    const nodes = outline
      .map((item) => root.querySelector<HTMLElement>(`#${item.id}`))
      .filter((node): node is HTMLElement => Boolean(node));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.id;
        if (id) setActiveHeading(id);
      },
      { root, rootMargin: "-12% 0px -62% 0px", threshold: [0, 1] },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [outline, editing, renderTick]);

  const openedHash = useRef(false);
  useEffect(() => {
    if (openedHash.current || editing) return;
    const id = window.location.hash.replace(/^#/, "");
    const root = contentRef.current;
    if (!id || !root || !outline.some((item) => item.id === id)) return;
    openedHash.current = true;
    scrollHeadingIntoView(id, root);
  }, [outline, editing]);

  const currentHeading = outline.some((item) => item.id === activeHeading)
    ? activeHeading
    : (outline[0]?.id ?? "");

  function jumpToHeading(id: string) {
    const root = contentRef.current;
    if (!root) return;
    scrollHeadingIntoView(id, root);
    setActiveHeading(id);
    window.history.replaceState(
      null, "", `${window.location.pathname}${window.location.search}#${id}`,
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
                进度 {Math.round(progress)}%
              </span>
              {quizDay && !readOnly && (
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
                    onClick={() => setShareOpen(true)}
                    className="reader-icon-button"
                    title="分享这一篇（免登录链接，始终看到最新版）"
                    aria-label="分享这一篇"
                  >
                    <Share2 aria-hidden="true" />
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
                    onClick={() =>
                      setAiOpen((current) => !current)
                    }
                    className={
                      aiOpen
                        ? "reader-icon-button reader-icon-button--active"
                        : "reader-icon-button"
                    }
                    title="AI 助手（支持上传附件、提问与改写整理）"
                    aria-label="AI 助手与整理"
                  >
                    <BotMessageSquare aria-hidden="true" />
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
                    onClick={() => void toggleFavorite()}
                    className={
                      article.favoritedAt
                        ? "reader-icon-button reader-icon-button--active"
                        : "reader-icon-button"
                    }
                    title={article.favoritedAt ? "从收藏夹移除" : "加入收藏夹"}
                    aria-label={article.favoritedAt ? "从收藏夹移除" : "加入收藏夹"}
                    aria-pressed={Boolean(article.favoritedAt)}
                  >
                    <Star
                      aria-hidden="true"
                      fill={article.favoritedAt ? "currentColor" : "none"}
                    />
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
            style={{ "--progress": progress / 100 } as CSSProperties}
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
                    <i
                      className={
                        dirty
                          ? "reader-hint-dot reader-hint-dot--dirty"
                          : "reader-hint-dot"
                      }
                      aria-hidden="true"
                      title={dirty ? "有未保存的修改" : "暂无修改"}
                    />
                    <span className="reader-hint-text">
                      {saveError ||
                        editNotice ||
                        `原位编辑中 · ${dirty ? "有未保存修改 · " : ""}⌘S 或点“完成”保存 · ESC 放弃${article.url?.startsWith("obsidian://") ? readOnly ? " · 保存到云端并备份旧版" : " · 保存后写回 Obsidian Vault" : ""}`}
                    </span>
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
            {editing && (
              <EditToolbar
                containerRef={contentRef}
                onInsertTable={handleInsertTable}
                onInsertMermaid={handleInsertMermaid}
              />
            )}
            <div className="reader-stage">
              {outline.length >= 2 && (
                <aside className="reader-toc" aria-label="篇内导航">
                  <p className="reader-toc-kicker">
                    本篇目录
                    <span>{outline.length} 个小节</span>
                  </p>
                  <ArticleOutline items={outline} activeId={currentHeading} onJump={jumpToHeading} />
                </aside>
              )}
            <article className="reader-article">
              <ViewTransition
                name={`document-${article.id}`}
                share="document-morph"
                default="none"
              >
                <header className="reader-article-intro">
                  <h1>{article.title}</h1>
                  <p className="reader-byline">
                    <span>{articleOrigin(article)}</span>
                    {articleStamp(article.updatedAt) && (
                      <span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={article.updatedAt}>{articleStamp(article.updatedAt)}</time>
                      </span>
                    )}
                    <span><span aria-hidden="true">·</span>约 {minutes} 分钟阅读</span>
                  </p>
                  <ReaderTuner font={font} size={size} onFont={setFont} onSize={setSize} />
                  {article.tags.length > 0 && <div className="reader-tags">
                    {article.tags.map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>}
                  {outline.length >= 2 && (
                    <details className="reader-toc-mobile">
                      <summary>本篇目录<span>{outline.length} 个小节</span></summary>
                      <ArticleOutline items={outline} activeId={currentHeading} onJump={jumpToHeading} />
                    </details>
                  )}
                </header>
              </ViewTransition>
              <MarkdownArticle
                key={editing ? "editing" : "preview"}
                content={article.content}
                title={article.title}
                font={font}
                size={size}
                editing={editing}
                articleId={articleId}
                quizDay={quizDay}
                quizWrong={quizWrong}
                onToggleWrong={toggleEmbedWrong}
                onMarkClick={handleMarkClick}
                onTableNotice={handleTableNotice}
                onRendered={handleArticleRendered}
              />
            </article>
            </div>
          </div>
        </div>

        {deskOpen && (
          <AnnotationDesk
            key={`annotation-${deskRequestKey}`}
            articleId={articleId}
            articleTitle={article.title}
            articleContent={article.content}
            articleSource={article.source}
            notes={article.notes}
            highlights={article.highlights}
            activeTab={deskTab}
            selection={deskSelection}
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

        {aiOpen && !editing && (
          <ReaderAiChat
            key={`ai-chat-${aiRequestKey}`}
            articleId={articleId}
            articleTitle={article.title}
            articleContent={article.content}
            selection={aiChatSelection}
            initialQuestion={aiQuestion}
            onClose={() => setAiOpen(false)}
            onApplyEdit={applyAiEdit}
          />
        )}

        {/* 选中浮窗 */}
        {!readOnly && <HighlightToolbar
          position={selection}
          onHighlight={applyHighlight}
          onNote={handleNote}
          onIngest={handleIngest}
          onAskAi={handleAskAi}
          onBold={() => void applyBold()}
        />}

        {pendingDelete && article && (
          <DeleteDocumentDialog
            doc={{ id: article.id, title: article.title, url: article.url }}
            onDeleted={() => router.replace("/reading")}
            onClose={() => setPendingDelete(false)}
          />
        )}

        {shareOpen && article && (
          <ShareDialog
            articleId={article.id}
            title={article.title}
            onClose={() => setShareOpen(false)}
          />
        )}
      </div>
    </ViewTransition>
  );
}

const RESTORE_PROGRESS_MIN = 3;
const RESTORE_PROGRESS_MAX = 97;

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

function scrollHeadingIntoView(id: string, root: HTMLElement) {
  const target = root.querySelector<HTMLElement>(`#${id}`);
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 16;
  root.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
}

function getTextOffset(
  container: Node,
  range: Range,
  edge: "start" | "end" = "start",
) {
  const leading = document.createRange();
  leading.selectNodeContents(container);
  if (edge === "start") leading.setEnd(range.startContainer, range.startOffset);
  else leading.setEnd(range.endContainer, range.endOffset);
  return leading.toString().length;
}

function createHighlightSpan(color: string) {
  const span = document.createElement("span");
  span.className = "highlight-mark";
  span.dataset.color = color;
  span.style.background = HIGHLIGHT_BG[color] || HIGHLIGHT_BG.yellow;
  return span;
}

const MarkdownArticle = memo(function MarkdownArticle({
  content,
  title,
  font = "serif",
  size = "md",
  editing = false,
  articleId = null,
  onMarkClick,
  onTableNotice,
  onRendered,
  quizDay,
  quizWrong,
  onToggleWrong,
}: {
  content: string;
  title?: string;
  font?: ReaderFont;
  size?: ReaderSize;
  editing?: boolean;
  articleId?: string | null;
  quizDay?: string | null;
  quizWrong?: number[];
  onToggleWrong?: (qIndex: number, on: boolean) => void;
  onMarkClick?: (text: string) => void;
  onTableNotice?: (message: string, isError?: boolean) => void;
  onRendered?: () => void;
}) {
  const router = useRouter();
  const [linkMap, setLinkMap] = useState<Record<string, string>>({});
  const proseRef = useRef<HTMLDivElement>(null);
  // 编辑态正文不写回 state：占位提示靠监听输入跟踪 DOM 是否仍为空
  const [domEmpty, setDomEmpty] = useState(content.trim() === "");
  const quizWrongRef = useRef(quizWrong);
  // 整篇 Markdown 解析很重：只在正文或链接映射变化时重算，选区/进度等状态变化不再触发
  const blocks = useMemo(() => splitMermaidBlocks(content), [content]);
  const fragmentHtml = useMemo(
    () => {
      const options: RenderOptions = { headings: { section: 0, subsection: 0 } };
      return blocks.map((block) =>
        block.type === "mermaid" ? "" : renderMarkdown(block.content, linkMap, options),
      );
    },
    [blocks, linkMap],
  );

  useEffect(() => {
    quizWrongRef.current = quizWrong;
    // 错题收录状态变化时同步已挂载的开关，不必重新拉取题集
    const el = proseRef.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>(".quiz-embed-options[data-q-index]").forEach((block) => {
      const button = block.querySelector<HTMLButtonElement>(".quiz-embed-wrong-btn");
      if (!button) return;
      const on = (quizWrong ?? []).includes(Number(block.dataset.qIndex));
      button.classList.toggle("quiz-embed-wrong-btn--on", on);
      button.dataset.label = on ? "已收录错题" : "收录错题";
    });
  }, [quizWrong]);

  // 正文 DOM 被重写（首渲染 / 链接回填 / 退出编辑）后通知父组件重新挂载标记
  useEffect(() => {
    if (!editing) onRendered?.();
  }, [fragmentHtml, editing, onRendered]);

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
          const on = (quizWrongRef.current ?? []).includes(match.index);
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
  }, [content, linkMap, editing, quizDay, onToggleWrong]);

  // 正文以与文章标题相同的 H1 开头时视觉隐藏：intro 卡片已展示标题，重复出现排版很重。
  // 只隐藏不删除——原位编辑保存走 serializeProse（从 DOM 反序列化），节点必须在。
  useEffect(() => {
    const el = proseRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(
      ".reader-markdown-fragment:first-child > h1:first-child",
    );
    if (!first) return;
    const dup = Boolean(title) && (first.textContent ?? "").trim() === title?.trim();
    first.classList.toggle("reader-h1--dup", dup);
  }, [fragmentHtml, title]);

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

  // 输入/撤销都走 input 事件：据此切换空文占位提示
  useEffect(() => {
    const prose = proseRef.current;
    if (!prose) return;
    const sync = () => setDomEmpty((prose.textContent ?? "").trim() === "");
    sync();
    prose.addEventListener("input", sync);
    return () => prose.removeEventListener("input", sync);
  }, [content, editing]);

  return (
    <>
    <div
      ref={proseRef}
      className={
        editing ? "reader-prose reader-prose--editing" : "reader-prose"
      }
      data-font={font}
      data-size={size}
      contentEditable={editing || undefined}
      suppressContentEditableWarning
      spellCheck={false}
      onKeyDown={(event) => {
        if (!editing) return;
        if (event.key === "Backspace") {
          const sel = window.getSelection();
          if (sel && sel.isCollapsed && sel.rangeCount > 0) {
            const anchor = sel.anchorNode;
            const el =
              anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
            const heading = el?.closest("h1, h2, h3, h4, h5, h6, blockquote");
            if (heading && (heading.textContent ?? "").trim() === "") {
              event.preventDefault();
              const p = document.createElement("p");
              p.innerHTML = "<br>";
              heading.replaceWith(p);
              const range = document.createRange();
              range.setStart(p, 0);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              proseRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }
        }
      }}
      onClick={(event) => {
        if (editing) {
          // 编辑态下阻止链接跳转与复制按钮，点击仅用于放置光标；
          // Mermaid 图块内部是自带交互的编辑器（contentEditable=false），放行
          if (!(event.target as HTMLElement).closest(".mermaid-diagram")) {
            event.preventDefault();
          }
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
          <MermaidDiagram
            source={block.content}
            editable={editing}
            key={`mermaid-${index}`}
          />
        ) : (
          <div
            className="reader-markdown-fragment"
            dangerouslySetInnerHTML={{ __html: fragmentHtml[index] }}
            key={`markdown-${index}`}
          />
        ),
      )}
    </div>
    {editing && domEmpty && (
      // 占位在 .reader-prose 之外：serializeProse 只遍历正文顶层子节点，不会把它写进文档
      <p className="reader-prose-placeholder" aria-hidden="true">
        空白文档 · 直接开始写，或从上方工具条插入标题、表格与流程图
      </p>
    )}
    </>
  );
});

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


/**
 * 在 Markdown 源码里定位渲染后的选中文本并做加粗/取消加粗。
 * 渲染文本与源码的差异是空白（软换行合并）与行内标记（**、` 等）被剥掉，
 * 所以逐字符之间允许出现少量空白/标记字符；围栏、wikilink 内不做手术。
 */
function boldInSource(
  content: string,
  selected: string,
): { content: string; unbolded: boolean } | null {
  const joiner = "[\\s*_~>#]*";
  const pattern = selected
    .split("")
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(joiner);
  const regex = new RegExp(pattern);
  const match = regex.exec(content);
  if (!match) return null;
  // 跨段误配防线：匹配到的源码跨度不应远超选区本身
  if (match[0].length > selected.length * 2 + 8) return null;
  const start = match.index;
  const end = start + match[0].length;

  // 围栏内不动（``` 成对计数，奇数说明在围栏里）
  const fencesBefore = (content.slice(0, start).match(/```/g) ?? []).length;
  if (fencesBefore % 2 === 1) return null;
  // wikilink 内不动（[[ 多于 ]] 说明在链接里）
  const before = content.slice(0, start);
  if ((before.match(/\[\[/g) ?? []).length > (before.match(/\]\]/g) ?? []).length) {
    return null;
  }

  // 已是 **选区** 时切换为取消加粗
  if (content.slice(start - 2, start) === "**" && content.slice(end, end + 2) === "**") {
    return {
      content: content.slice(0, start - 2) + match[0] + content.slice(end + 2),
      unbolded: true,
    };
  }
  return { content: content.slice(0, start) + `**${match[0]}**` + content.slice(end), unbolded: false };
}

/** 引用/callout 正文：空的 > 行分段，段内软换行合并 */

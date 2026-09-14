"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  Folder,
  Highlighter,
  Loader2,
  Save,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createDawnHandoff } from "@/lib/dawn-agent-handoff-client";

export type AnnotationTab = "note" | "agent" | "ingest";

type SelectionAnchor = {
  text: string;
  context: string;
};

type Note = {
  id: string;
  content: string;
  quote: string | null;
  createdAt: string;
};

type Highlight = {
  id: string;
  text: string;
  color: string;
  note: string | null;
  createdAt: string;
};

type VaultFolder = {
  name: string;
  path: string;
  fileCount: number;
};

interface AnnotationDeskProps {
  articleId: string;
  articleTitle: string;
  articleContent: string;
  articleSource?: string | null;
  articleUrl?: string | null;
  notes: Note[];
  highlights: Highlight[];
  activeTab: AnnotationTab;
  selection: SelectionAnchor | null;
  initialQuestion?: string;
  onTabChange: (tab: AnnotationTab) => void;
  onClose: () => void;
  onNoteCreated: (note: Note) => void;
  onHighlightCreated: (highlight: Highlight) => void;
  onNoteDeleted: (id: string) => void;
  onHighlightDeleted: (id: string) => void;
}

const QUICK_TASKS = [
  "用更简单的话解释，并说明它与全文的关系",
  "检查这段观点的前提、漏洞和反例",
  "把这段内容转成可执行的项目任务",
];

// 取笔记开头第一段引用行（理解记录的 > 块），用于筛选时匹配当前选择
function firstQuoteBlock(content: string): string {
  const quoted: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^>\s?(.*)$/);
    if (match) quoted.push(match[1]);
    else if (quoted.length) break;
  }
  return quoted.join("\n").trim();
}

export function AnnotationDesk({
  articleId,
  articleTitle,
  articleContent,
  articleSource,
  articleUrl,
  notes,
  highlights,
  activeTab,
  selection,
  initialQuestion = "",
  onTabChange,
  onClose,
  onNoteCreated,
  onHighlightCreated,
  onNoteDeleted,
  onHighlightDeleted,
}: AnnotationDeskProps) {
  const router = useRouter();
  const [noteInput, setNoteInput] = useState("");
  const [question, setQuestion] = useState(
    initialQuestion || (selection?.text ? QUICK_TASKS[0] : "概括全文的核心观点，并给出下一步可执行建议"),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [folderError, setFolderError] = useState("");
  const [targetFolder, setTargetFolder] = useState("");
  const [ingestTitle, setIngestTitle] = useState(`${articleTitle} · 阅读笔记`);
  const [includeArticle, setIncludeArticle] = useState(articleSource !== "obsidian");
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeHighlights, setIncludeHighlights] = useState(true);
  const [ingestResult, setIngestResult] = useState("");

  const quoteNotes = useMemo(() => highlights.filter((item) => item.note), [highlights]);
  const totalNotes = notes.length + quoteNotes.length;
  // 带选择打开（如点击正文标记）时直接看“当前选择”，否则看全部
  const [savedFilter, setSavedFilter] = useState<"all" | "selection">(selection ? "selection" : "all");
  const selectionText = selection?.text.trim() ?? "";
  const visibleHighlights = useMemo(() => {
    if (savedFilter !== "selection" || !selectionText) return quoteNotes;
    return quoteNotes.filter(
      (item) => item.text.includes(selectionText) || selectionText.includes(item.text.trim()),
    );
  }, [quoteNotes, savedFilter, selectionText]);
  const visibleNotes = useMemo(() => {
    if (savedFilter !== "selection" || !selectionText) return notes;
    return notes.filter((note) => {
      const quote = note.quote || firstQuoteBlock(note.content);
      if (quote) return quote.includes(selectionText) || selectionText.includes(quote);
      return note.content.includes(selectionText);
    });
  }, [notes, savedFilter, selectionText]);
  const visibleTotal = visibleHighlights.length + visibleNotes.length;

  useEffect(() => {
    if (activeTab !== "ingest" || folders.length > 0) return;
    let cancelled = false;
    async function loadFolders() {
      try {
        const response = await fetch("/api/obsidian/library?mode=folders");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "无法读取 Vault 文件夹");
        if (cancelled) return;
        const nextFolders = data.folders as VaultFolder[];
        setFolders(nextFolders);
        const inboxFolders = nextFolders.filter((folder) => /(^|\/)(00-)?inbox$|收件箱$/i.test(folder.path));
        const preferred = inboxFolders.find((folder) => folder.path.split("/").length === 2)
          || inboxFolders[0]
          || nextFolders.find((folder) => /笔记|note|阅读/i.test(folder.path));
        setTargetFolder((current) => current || preferred?.path || nextFolders[0]?.path || "");
      } catch (error) {
        if (!cancelled) setFolderError(error instanceof Error ? error.message : "无法读取 Vault 文件夹");
      }
    }
    loadFolders();
    return () => {
      cancelled = true;
    };
  }, [activeTab, folders.length]);

  async function saveNote() {
    if (!noteInput.trim() || busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (selection?.text) {
        const startOffset = articleContent.indexOf(selection.text);
        const response = await fetch("/api/highlights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: selection.text,
            color: "yellow",
            note: noteInput.trim(),
            articleId,
            prefix: startOffset >= 0 ? articleContent.slice(Math.max(0, startOffset - 50), startOffset) : "",
            suffix: startOffset >= 0
              ? articleContent.slice(startOffset + selection.text.length, startOffset + selection.text.length + 50)
              : "",
            startOffset: startOffset >= 0 ? startOffset : null,
            endOffset: startOffset >= 0 ? startOffset + selection.text.length : null,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "保存失败");
        onHighlightCreated(data);
      } else {
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: noteInput.trim(), articleId }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "保存失败");
        onNoteCreated(data);
      }
      setNoteInput("");
      setNotice("笔记已保存到当前文章");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handoffToDawn() {
    const instruction = question.trim();
    if (!instruction || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const handoff = await createDawnHandoff({
        sourceType: selection?.text ? "reading-selection" : "reading-document",
        sourceTitle: articleTitle,
        sourcePath: articleUrl?.startsWith("obsidian://") ? articleUrl.slice("obsidian://".length) : articleUrl ?? undefined,
        sourceRef: articleId,
        selectedText: selection?.text || undefined,
        context: selection?.context || articleContent.slice(0, 36_000),
        instruction,
        metadata: {
          articleSource: articleSource ?? "local",
          articleId,
        },
      });
      router.push(`/dawn-agent?handoff=${handoff.id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法交给 Dawn Agent");
      setBusy(false);
    }
  }

  async function deleteHighlight(id: string) {
    if (!window.confirm("删除这条批注？正文里的标记也会一并消失。")) return;
    try {
      const response = await fetch(`/api/highlights/${id}`, { method: "DELETE" });
      if (response.ok) onHighlightDeleted(id);
      else setNotice("删除失败");
    } catch {
      setNotice("删除失败");
    }
  }

  async function deleteNote(id: string) {
    if (!window.confirm("删除这条笔记？")) return;
    try {
      const response = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      if (response.ok) onNoteDeleted(id);
      else setNotice("删除失败");
    } catch {
      setNotice("删除失败");
    }
  }

  async function ingestToObsidian() {
    if (!ingestTitle.trim() || busy) return;
    setBusy(true);
    setNotice("");
    setIngestResult("");
    try {
      const response = await fetch("/api/obsidian/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId,
          targetFolder,
          title: ingestTitle.trim(),
          selectedText: selection?.text || "",
          includeArticle,
          includeNotes,
          includeHighlights,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "入库失败");
      setIngestResult(data.relativePath);
      setNotice("已写入 Obsidian，并同步回 DawnKB");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "入库失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="annotation-desk">
      <div className="annotation-desk-head">
        <div>
          <p className="micro-label">ANNOTATION DESK</p>
          <strong>阅读批注台</strong>
        </div>
        <button type="button" onClick={onClose} className="reader-panel-close" aria-label="关闭批注台">
          <X aria-hidden="true" />
        </button>
      </div>

      <div className="annotation-tabs" role="tablist" aria-label="批注功能">
        <DeskTab active={activeTab === "note"} onClick={() => onTabChange("note")} icon={StickyNote} label="笔记" badge={totalNotes} />
        <DeskTab active={activeTab === "agent"} onClick={() => onTabChange("agent")} icon={Bot} label="Dawn Agent" />
        <DeskTab active={activeTab === "ingest"} onClick={() => onTabChange("ingest")} icon={Database} label="入库" />
      </div>

      <div className="annotation-body">
        {activeTab === "note" && (
          <section className="annotation-section">
            <div className="annotation-section-title">
              <div><p className="micro-label">NOTE</p><h2>{selection?.text ? "给这段原文加备注" : "给整篇文章加笔记"}</h2></div>
              <StickyNote aria-hidden="true" />
            </div>
            {selection?.text && <QuoteCard text={selection.text} label="选中的原文" />}
            <textarea
              className="textarea annotation-textarea"
              value={noteInput}
              onChange={(event) => setNoteInput(event.target.value)}
              placeholder={selection?.text ? "写下你对这段话的判断、联想或疑问…" : "记录这篇文章带给你的想法…"}
              rows={5}
            />
            <button type="button" className="button button-purple annotation-primary" onClick={saveNote} disabled={busy || !noteInput.trim()}>
              {busy ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <Save aria-hidden="true" />} 保存笔记
            </button>

            <div className="annotation-saved">
              <div className="annotation-list-heading">
                <span>已保存</span>
                <span className="saved-heading-right">
                  <strong>{savedFilter === "all" ? totalNotes : visibleTotal}</strong>
                  <span className="saved-filter" role="group" aria-label="标注筛选">
                    <button
                      type="button"
                      className={savedFilter === "all" ? "saved-filter-btn saved-filter-btn--on" : "saved-filter-btn"}
                      onClick={() => setSavedFilter("all")}
                    >
                      全部
                    </button>
                    <button
                      type="button"
                      className={savedFilter === "selection" ? "saved-filter-btn saved-filter-btn--on" : "saved-filter-btn"}
                      onClick={() => setSavedFilter("selection")}
                      disabled={!selectionText}
                      title={selectionText ? "只看与当前选择相关的标注" : "在正文里划选一段文字后可用"}
                    >
                      当前选择
                    </button>
                  </span>
                </span>
              </div>
              {visibleTotal === 0 ? (
                <p className="reader-panel-empty">
                  {savedFilter === "selection" && selectionText
                    ? "当前选择还没有关联标注。"
                    : "这里会收拢全文笔记与带引用的段落批注。"}
                </p>
              ) : (
                <>
                  {visibleHighlights.map((highlight) => (
                    <article className="saved-highlight" key={highlight.id}>
                      <button
                        type="button"
                        className="saved-delete"
                        title="删除这条批注"
                        onClick={() => deleteHighlight(highlight.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                      <p className="saved-highlight-quote">“{highlight.text}”</p>
                      <p className="saved-highlight-note">{highlight.note}</p>
                    </article>
                  ))}
                  {visibleNotes.map((note) => (
                    <article className="annotation-note" key={note.id}>
                      <button
                        type="button"
                        className="saved-delete"
                        title="删除这条笔记"
                        onClick={() => deleteNote(note.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                      {note.content}
                    </article>
                  ))}
                </>
              )}
            </div>
          </section>
        )}

        {activeTab === "agent" && (
          <section className="annotation-section annotation-agent">
            <div className="annotation-section-title">
              <div><p className="micro-label">HAND OFF TO DAWN</p><h2>{selection?.text ? "把这段内容变成 Agent 任务" : "让 Agent 接手当前文档"}</h2></div>
              <Bot aria-hidden="true" />
            </div>
            <div className="annotation-agent-context">
              <Bot aria-hidden="true" />
              <span><strong>上下文已准备</strong><small>{selection?.text ? "选中原文 + 附近段落 + 当前文档" : "当前文档标题 + 正文内容"}</small></span>
            </div>
            {selection?.text && <QuoteCard text={selection.text} label="将交给 Dawn Agent 的原文" />}
            <div className="annotation-quick-questions">
              {QUICK_TASKS.map((item) => <button type="button" key={item} className={question === item ? "is-active" : ""} onClick={() => setQuestion(item)} disabled={busy}>{item}</button>)}
            </div>
            <div className="ai-composer">
              <textarea
                autoFocus
                className="textarea annotation-textarea"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void handoffToDawn();
                  }
                }}
                placeholder="说明你希望 Dawn Agent 理解、验证或执行什么…"
                rows={4}
              />
              <div className="ai-composer-actions">
                <span className="annotation-agent-hint">下一步选择项目或当前 Agent 会话</span>
                <button type="button" className="button button-ink" onClick={() => void handoffToDawn()} disabled={busy || !question.trim()}>
                  {busy ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />} {busy ? "正在打包…" : "交给 Dawn Agent"}
                </button>
              </div>
            </div>
          </section>
        )}

        {activeTab === "ingest" && (
          <section className="annotation-section">
            <div className="annotation-section-title">
              <div><p className="micro-label">INGEST</p><h2>写入你的 Obsidian</h2></div>
              <Database aria-hidden="true" />
            </div>
            <p className="annotation-help">选择 Vault 里已经存在的目录。DawnKB 只会新建 Markdown 笔记，不覆盖同名文件。</p>
            <label className="annotation-field">
              <span>笔记标题</span>
              <input className="input" value={ingestTitle} onChange={(event) => setIngestTitle(event.target.value)} />
            </label>
            <label className="annotation-field">
              <span>目标文件夹</span>
              <div className="annotation-folder-select">
                <Folder aria-hidden="true" />
                <select className="select" value={targetFolder} onChange={(event) => setTargetFolder(event.target.value)} disabled={Boolean(folderError)}>
                  <option value="">{folders.length ? "Vault 根目录" : "正在读取目录…"}</option>
                  {folders.map((folder) => <option value={folder.path} key={folder.path}>{folder.path} · {folder.fileCount} 篇</option>)}
                </select>
              </div>
            </label>
            {folderError && <p className="annotation-error">{folderError}</p>}
            <div className="annotation-package">
              <p className="micro-label">PACKAGE</p>
              <CheckRow checked={includeNotes} onChange={setIncludeNotes} title="全文笔记" meta={`${notes.length} 条`} />
              <CheckRow checked={includeHighlights} onChange={setIncludeHighlights} title="引用与批注" meta={`${highlights.length} 条`} />
              <CheckRow checked={includeArticle} onChange={setIncludeArticle} title="附带原文存档" meta={articleSource === "obsidian" ? "原文已在 Vault" : "1 篇"} />
              {selection?.text && <div className="annotation-package-selected"><Highlighter aria-hidden="true" />本次选中的原文也会一并写入</div>}
            </div>
            <button type="button" className="button button-purple annotation-primary" onClick={ingestToObsidian} disabled={busy || !ingestTitle.trim() || Boolean(folderError)}>
              {busy ? <Loader2 className="ai-spinner" aria-hidden="true" /> : <Database aria-hidden="true" />} {busy ? "正在入库…" : "写入 Obsidian"}
            </button>
            {ingestResult && <div className="annotation-success"><CheckCircle2 aria-hidden="true" /><span><strong>入库完成</strong><small>{ingestResult}</small></span></div>}
          </section>
        )}

        {notice && <p className="annotation-notice" role="status">{notice}</p>}
      </div>
    </aside>
  );
}

function DeskTab({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: typeof StickyNote; label: string; badge?: number }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={active ? "active" : ""} onClick={onClick}>
      <Icon aria-hidden="true" /><span>{label}</span>{badge !== undefined && <small>{badge}</small>}
    </button>
  );
}

function QuoteCard({ text, label }: { text: string; label: string }) {
  return (
    <div className="annotation-quote-card">
      <div><span>99</span><strong>{label}</strong></div>
      <p>{text}</p>
    </div>
  );
}

function CheckRow({ checked, onChange, title, meta }: { checked: boolean; onChange: (checked: boolean) => void; title: string; meta: string }) {
  return (
    <label className="annotation-check-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span><strong>{title}</strong><small>{meta}</small></span>
    </label>
  );
}

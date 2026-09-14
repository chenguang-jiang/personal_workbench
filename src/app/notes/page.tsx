"use client";

/* eslint-disable @next/next/no-img-element -- 预览本地 Blob 与受保护的 Obsidian 资源，不经过远程图片优化器。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import {
  Check,
  Copy,
  FolderInput,
  ImagePlus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useUiPrefs } from "@/lib/ui-prefs";

interface QuickNote {
  id: string;
  content: string;
  status: string;
  tags: string[];
  images: string[];
  vaultPath: string | null;
  aiMeta: string | null;
  createdAt: string;
}

interface Attachment {
  path: string;
  url: string;
}

interface AiSuggestion {
  summary?: string;
  tags?: string[];
  folder?: string;
}

const NOTE_COLORS = ["#fff6c9", "#ffe4ef", "#e2f6e7", "#e4ecff", "#f4e7ff"];

function seedOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1)
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export default function QuickNotesPage() {
  const { t } = useUiPrefs();
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "inbox" | "organized">("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/quick-notes");
      if (response.ok) setNotes((await response.json()).notes ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    return notes.filter((note) => {
      if (filter === "inbox" && note.status !== "inbox") return false;
      if (filter === "organized" && note.status !== "organized") return false;
      if (search && !note.content.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [notes, filter, search]);

  async function uploadFile(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/quick-notes/assets", {
      method: "POST",
      body: form,
    });
    setUploading(false);
    if (response.ok) {
      const data = await response.json();
      setAttachments((current) =>
        current.some((item) => item.path === data.path)
          ? current
          : [...current, { path: data.path, url: data.url }],
      );
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) return;
    event.preventDefault();
    void Promise.all(files.map(uploadFile));
  }

  async function create() {
    const content = draft.trim();
    if ((!content && attachments.length === 0) || saving || uploading) return;
    setSaving(true);
    const response = await fetch("/api/quick-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        images: attachments.map((item) => item.path),
      }),
    });
    if (response.ok) {
      setDraft("");
      setAttachments([]);
      await load();
    }
    setSaving(false);
  }

  async function apply(id: string) {
    setBusyId(id);
    await fetch(`/api/quick-notes/${id}/apply`, { method: "POST" });
    setBusyId(null);
    await load();
  }

  async function patch(id: string, data: Record<string, unknown>) {
    const response = await fetch(`/api/quick-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (response.ok) await load();
  }

  async function remove(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      window.setTimeout(
        () => setConfirmId((current) => (current === id ? null : current)),
        2400,
      );
      return;
    }
    setConfirmId(null);
    await fetch(`/api/quick-notes/${id}`, { method: "DELETE" });
    await load();
  }

  async function organize(id: string) {
    setBusyId(id);
    await fetch(`/api/quick-notes/${id}/organize`, { method: "POST" });
    setBusyId(null);
    await load();
  }

  const inboxCount = notes.filter((note) => note.status === "inbox").length;

  return (
    <div className="notes-page">
      <section className="panel notes-composer-panel">
        <div className="panel-heading">
          <div>
            <p className="micro-label">QUICK CAPTURE</p>
            <h2>{t("notes_title")}</h2>
          </div>
          <span className="tag">{t("notes_pending", { n: inboxCount })}</span>
        </div>
        <div className="notes-composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void create();
              }
            }}
            placeholder="灵感、摘抄、还没想好放哪的一切…先贴上来，回头再整理。可以直接粘贴图片。"
            rows={3}
          />
          {(attachments.length > 0 || uploading) && (
            <div className="notes-attachments">
              {attachments.map((item) => (
                <span key={item.path} className="notes-attachment">
                  <img src={item.url} alt="" />
                  <button
                    type="button"
                    aria-label="移除图片"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((attach) => attach.path !== item.path),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              {uploading && (
                <span className="notes-attachment notes-attachment--loading">
                  上传中…
                </span>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) void Promise.all(files.map(uploadFile));
              event.target.value = "";
            }}
          />
          <div className="notes-composer-foot">
            <span className="notes-composer-hint">
              <button
                type="button"
                className="notes-attach"
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus aria-hidden="true" /> 图片
              </button>
              ⌘/Ctrl + Enter 快速贴上 · ⌘V 粘贴截图
            </span>
            <button
              type="button"
              className="notes-save"
              onClick={() => void create()}
              disabled={saving || !draft.trim()}
            >
              {saving ? "贴上去…" : "贴上便利贴"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel notes-wall-panel">
        <div className="panel-heading notes-wall-head">
          <div className="notes-tabs">
            {(
              [
                ["all", "全部"],
                ["inbox", "待整理"],
                ["organized", "已整理"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={
                  filter === key ? "notes-tab notes-tab--active" : "notes-tab"
                }
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="notes-search">
            <Search aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索便签…"
            />
          </label>
        </div>

        {loading ? (
          <div className="notes-wall">
            {[1, 2, 3, 4].map((item) => (
              <div className="skeleton notes-skeleton" key={item} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="notes-empty">
            <strong>{search ? "没有匹配的便签" : "墙上还空着"}</strong>
            <span>
              {search
                ? "换个关键词试试。"
                : "把第一个灵感贴上来，灵感这回事，抓住就不亏。"}
            </span>
          </div>
        ) : (
          <div className="notes-wall">
            {visible.map((note) => {
              const seed = seedOf(note.id);
              const suggestion: AiSuggestion | null = note.aiMeta
                ? safeParse(note.aiMeta)
                : null;
              return (
                <article
                  key={note.id}
                  className={
                    note.status === "organized"
                      ? "sticky-note sticky-note--organized"
                      : "sticky-note"
                  }
                  style={{
                    background: NOTE_COLORS[seed % NOTE_COLORS.length],
                    transform: `rotate(${((seed % 5) - 2) * 0.7}deg)`,
                  }}
                >
                  <p className="sticky-note-content">{note.content}</p>
                  {note.images.length > 0 && (
                    <div className="sticky-note-images">
                      {note.images.map((image) => (
                        <img
                          key={image}
                          src={`/api/obsidian/asset?path=${encodeURIComponent(image)}`}
                          alt=""
                          loading="lazy"
                        />
                      ))}
                    </div>
                  )}
                  {note.vaultPath && (
                    <span className="sticky-note-vault">
                      已归档 · {note.vaultPath}
                    </span>
                  )}
                  {note.tags.length > 0 && (
                    <div className="sticky-note-tags">
                      {note.tags.map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                  )}
                  {suggestion && (
                    <div className="sticky-note-ai">
                      <strong>
                        <Sparkles aria-hidden="true" /> AI 建议
                      </strong>
                      {suggestion.summary && <p>{suggestion.summary}</p>}
                      <p className="sticky-note-ai-folder">
                        <FolderInput aria-hidden="true" /> 归入「
                        {suggestion.folder}」
                      </p>
                      <div className="sticky-note-ai-actions">
                        <button
                          type="button"
                          disabled={busyId === note.id}
                          onClick={() => void apply(note.id)}
                        >
                          {busyId === note.id
                            ? "归档中…"
                            : "采纳并归档到 vault"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void patch(note.id, { aiMeta: null })}
                        >
                          忽略
                        </button>
                      </div>
                    </div>
                  )}
                  <footer className="sticky-note-foot">
                    <time>{formatDate(note.createdAt)}</time>
                    <div className="sticky-note-actions">
                      <button
                        type="button"
                        title="复制内容"
                        aria-label="复制内容"
                        onClick={() =>
                          void navigator.clipboard?.writeText(note.content)
                        }
                      >
                        <Copy aria-hidden="true" />
                      </button>
                      {!suggestion && (
                        <button
                          type="button"
                          title="AI 整理"
                          aria-label="AI 整理"
                          disabled={busyId === note.id}
                          onClick={() => void organize(note.id)}
                        >
                          <Sparkles aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        title={
                          note.status === "organized"
                            ? "标回待整理"
                            : "标记已整理"
                        }
                        aria-label="标记整理状态"
                        className={
                          note.status === "organized" ? "sticky-action--on" : ""
                        }
                        onClick={() =>
                          void patch(note.id, {
                            status:
                              note.status === "organized"
                                ? "inbox"
                                : "organized",
                          })
                        }
                      >
                        <Check aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        title={
                          confirmId === note.id ? "再点一次确认删除" : "删除"
                        }
                        aria-label="删除"
                        className={
                          confirmId === note.id ? "sticky-action--danger" : ""
                        }
                        onClick={() => void remove(note.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function safeParse(value: string): AiSuggestion | null {
  try {
    return JSON.parse(value) as AiSuggestion;
  } catch {
    return null;
  }
}

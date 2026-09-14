"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FilePlus2, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

export default function NewArticlePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);

    const response = await fetch("/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        source: "manual",
      }),
    });

    if (response.ok) {
      const article = await response.json();
      router.push(`/reading/${article.id}`);
    } else {
      setSaving(false);
    }
  }

  return (
    <div className="page-frame">
      <Link href="/reading" className="back-link"><ArrowLeft aria-hidden="true" /> 返回书架</Link>
      <PageHeader
        eyebrow="NEW READING MATERIAL"
        title="导入一篇文章"
        description="保留原始内容与标签，保存后直接进入沉浸阅读和 AI 辅助工作流。"
      />

      <form onSubmit={handleSubmit} className="article-editor panel">
        <div className="article-editor-main">
          <label>
            <span>文章标题</span>
            <input className="input article-title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="这篇文章在讲什么？" required />
          </label>
          <label>
            <span>正文 · 支持 Markdown</span>
            <textarea className="textarea article-content-input" value={content} onChange={(event) => setContent(event.target.value)} placeholder="粘贴正文，或从标题开始写作…" rows={18} />
          </label>
        </div>
        <aside className="article-editor-side">
          <div className="editor-note">
            <FilePlus2 aria-hidden="true" />
            <strong>进入素材层</strong>
            <p>保存后可在正文中选中文字，进行解释、翻译、高亮和笔记。</p>
          </div>
          <label>
            <span>标签</span>
            <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="AI, 阅读, 创作" />
            <small>使用英文逗号分隔</small>
          </label>
          <button type="submit" disabled={saving || !title.trim()} className="button button-purple editor-save">
            <Save aria-hidden="true" /> {saving ? "正在保存…" : "保存并开始阅读"}
          </button>
          <Link href="/reading" className="button button-secondary">取消</Link>
        </aside>
      </form>
    </div>
  );
}

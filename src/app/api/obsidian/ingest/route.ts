import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncObsidianFile } from "@/lib/obsidian-sync";
import { resolveVaultPath } from "@/lib/obsidian-vault";

export const runtime = "nodejs";

type IngestBody = {
  articleId?: string;
  targetFolder?: string;
  title?: string;
  selectedText?: string;
  includeArticle?: boolean;
  includeNotes?: boolean;
  includeHighlights?: boolean;
};

function safeFileName(value: string) {
  return Array.from(value.replace(/[\\/:*?"<>|#[\]]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 80)
    .join("") || "DawnKB 阅读笔记";
}

function quoteBlock(value: string) {
  return value
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function reserveFilePath(directory: string, title: string) {
  const base = safeFileName(title);
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? "" : ` ${index}`;
    const candidate = path.join(directory, `${base}${suffix}.md`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("目标目录中同名笔记过多");
}

export async function POST(req: NextRequest) {
  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  }

  if (!body.articleId || !body.title?.trim()) {
    return NextResponse.json({ error: "缺少文章或入库标题" }, { status: 400 });
  }

  try {
    const target = resolveVaultPath(body.targetFolder || "");
    if (!fs.existsSync(target.absolutePath) || !fs.statSync(target.absolutePath).isDirectory()) {
      return NextResponse.json({ error: "选择的 Obsidian 文件夹不存在" }, { status: 400 });
    }

    const article = await prisma.article.findUnique({
      where: { id: body.articleId },
      include: {
        notes: { orderBy: { createdAt: "asc" } },
        highlights: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!article) return NextResponse.json({ error: "文章不存在" }, { status: 404 });

    const sections: string[] = [
      "---",
      `title: ${JSON.stringify(body.title.trim())}`,
      `created: ${new Date().toISOString()}`,
      "source: DawnKB",
      "tags:",
      "  - DawnKB",
      "  - 阅读笔记",
      "---",
      "",
      `# ${body.title.trim()}`,
      "",
      "## 来源",
      "",
      `- DawnKB 文章：${article.title}`,
    ];

    if (article.url?.startsWith("obsidian://")) {
      const sourcePath = article.url.slice("obsidian://".length).replace(/\.md$/i, "");
      sections.push(`- Obsidian 原文：[[${sourcePath}]]`);
    } else if (article.url) {
      sections.push(`- 原始链接：${article.url}`);
    }

    if (body.selectedText?.trim()) {
      sections.push("", "## 本次选中", "", quoteBlock(body.selectedText));
    }

    if (body.includeNotes !== false && article.notes.length > 0) {
      sections.push("", "## 阅读笔记", "");
      article.notes.forEach((note, index) => {
        sections.push(`### 笔记 ${index + 1}`, "", note.content.trim(), "");
      });
    }

    if (body.includeHighlights !== false && article.highlights.length > 0) {
      sections.push("", "## 引用与批注", "");
      article.highlights.forEach((highlight, index) => {
        sections.push(`### 引用 ${index + 1}`, "", quoteBlock(highlight.text));
        if (highlight.note) sections.push("", highlight.note.trim());
        sections.push("");
      });
    }

    if (body.includeArticle) {
      sections.push("", "## 原文存档", "", article.content?.trim() || "（原文为空）", "");
    }

    const filePath = reserveFilePath(target.absolutePath, body.title);
    fs.writeFileSync(filePath, `${sections.join("\n").trim()}\n`, { encoding: "utf-8", flag: "wx" });
    const syncResult = await syncObsidianFile(filePath);
    const relativePath = path.relative(target.vaultPath, filePath).split(path.sep).join("/");

    return NextResponse.json({
      success: true,
      relativePath,
      syncStatus: syncResult.status,
      message: `已写入 ${target.vaultName}/${relativePath}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "入库失败" },
      { status: 400 },
    );
  }
}

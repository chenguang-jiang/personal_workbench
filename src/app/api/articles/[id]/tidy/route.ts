import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chatOnce } from "@/lib/ai";

const countFences = (text: string) => (text.match(/```/g) ?? []).length;
const countHeadings = (text: string) => (text.match(/^#{1,6} /gm) ?? []).length;
// 整理只应改动空白与列表符号：去掉空白和列表标记后的“实质字符数”变化超过此比例即视为改写/截断
const visibleLength = (text: string) => text.replace(/[\s\-*+>]/g, "").length;
const MAX_CONTENT_DRIFT = 0.03;
// 提高一键整理长度上限至 100,000 字
const TIDY_MAX_CHARS = 100_000;

// POST /api/articles/[id]/tidy — AI 一键整理 Markdown 格式（只返回整理稿，应用由客户端走 PATCH）
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const article = await prisma.article.findUnique({ where: { id } });
  if (!article?.content?.trim()) {
    return NextResponse.json({ error: "文章没有可整理的内容" }, { status: 404 });
  }
  const original = article.content;
  if (original.length > TIDY_MAX_CHARS) {
    return NextResponse.json(
      { error: `文档超过 ${TIDY_MAX_CHARS.toLocaleString()} 字，暂不支持一键整理（避免截断丢失内容）` },
      { status: 413 },
    );
  }
  try {
    const proposed = await chatOnce({
      system:
        "你是 Markdown 格式整理工具。只整理格式：标题前后保留空行、列表/表格/代码块/引用块前后保留空行、统一列表符号与缩进、任务列表用 - [ ] / - [x]、删除多余空行与行尾空白、补全标题 # 后的空格。不得改写、删减、新增任何实质内容；代码块、mermaid 图、表格、链接、图片、wikilink 一律原样保留（仅允许调整其周围空行）。直接输出整理后的完整 Markdown，不要解释，不要整体包裹 ```。",
      messages: [
        { role: "user", content: `请整理下面这篇 Markdown 的格式：\n\n${original}` },
      ],
      maxTokens: 8000,
    });
    const clean = proposed.trim();
    if (!clean) throw new Error("AI 未返回内容");
    if (clean.length < original.length * 0.6) {
      return NextResponse.json({ error: "整理结果不完整（过短），已放弃，请重试" }, { status: 502 });
    }
    const drift = Math.abs(visibleLength(clean) - visibleLength(original)) / Math.max(1, visibleLength(original));
    if (drift > MAX_CONTENT_DRIFT) {
      return NextResponse.json({ error: "整理结果改动了正文内容，已放弃，请重试" }, { status: 502 });
    }
    if (countFences(clean) < countFences(original)) {
      return NextResponse.json({ error: "整理结果丢失了代码块，已放弃，请重试" }, { status: 502 });
    }
    if (countHeadings(clean) < countHeadings(original) - 1) {
      return NextResponse.json({ error: "整理结果丢失了标题，已放弃，请重试" }, { status: 502 });
    }
    return NextResponse.json({ content: clean });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "整理失败" },
      { status: 503 },
    );
  }
}

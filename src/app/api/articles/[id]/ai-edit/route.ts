import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chatOnce, getAiStatus } from "@/lib/ai";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

// 与一键整理同一上限：超长文档一次交不全模型，返回稿会截断丢内容
const AI_EDIT_MAX_CHARS = 12000;
// 返回稿显著短于原文多半是截断，直接拒绝（用户可能在预览里再要求删减，所以阈值放宽到 40%）
const MIN_RESULT_RATIO = 0.4;
const countFences = (text: string) => (text.match(/```/g) ?? []).length;

// POST /api/articles/[id]/ai-edit — 按指令 AI 修改文章内容（只返回修改稿，应用由客户端走 PATCH）
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await readJsonObject<{ instruction?: string; selection?: string }>(req);
  if (!body) return invalidJsonResponse();
  const instruction = body.instruction?.trim();
  if (!instruction) {
    return NextResponse.json({ error: "缺少修改指令" }, { status: 400 });
  }

  const article = await prisma.article.findUnique({ where: { id } });
  if (!article?.content?.trim()) {
    return NextResponse.json({ error: "文章没有可修改的内容" }, { status: 404 });
  }
  const original = article.content;
  if (original.length > AI_EDIT_MAX_CHARS) {
    return NextResponse.json(
      { error: `文档超过 ${AI_EDIT_MAX_CHARS.toLocaleString()} 字，暂不支持 AI 修改（避免截断丢失内容）` },
      { status: 413 },
    );
  }
  const status = await getAiStatus();
  if (!status.available) {
    return NextResponse.json({ error: `AI 未就绪：${status.detail}` }, { status: 503 });
  }

  const selection = body.selection?.trim();
  try {
    const proposed = await chatOnce({
      system: [
        "你是文章修改助手。根据用户的指令修改给出的 Markdown 文章，返回修改后的完整文章。",
        "要求：只做指令要求的修改，其余内容一字不改；保持原文的语言、语气和 Markdown 结构；",
        "代码块、mermaid 图、表格、链接、图片、wikilink 除指令明确要求外一律原样保留；",
        "直接输出修改后的完整 Markdown，不要解释，不要把全文包进 ``` 代码围栏。",
        selection ? "用户同时引用了一段原文，指令里的“这段/它”等指代以引用的原文为准。" : "",
      ]
        .filter(Boolean)
        .join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `文章标题：${article.title}`,
            selection ? `引用的原文（附前后文）：\n${selection}` : "",
            `修改指令：${instruction}`,
            `文章全文：\n\n${original}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      maxTokens: 8000,
    });
    const clean = proposed
      .trim()
      // 模型偶尔无视指令把全文包进围栏，剥掉成对的首尾围栏行
      .replace(/^```[a-zA-Z0-9_-]*\n/, "")
      .replace(/\n```$/, "");
    if (!clean) throw new Error("AI 未返回内容");
    if (clean.length < original.length * MIN_RESULT_RATIO) {
      return NextResponse.json({ error: "修改结果不完整（过短），已放弃，请重试" }, { status: 502 });
    }
    // 围栏数量必须成对且不少于原文：防止截断把代码块切一半
    if (countFences(clean) < countFences(original) || countFences(clean) % 2 !== 0) {
      return NextResponse.json({ error: "修改结果丢失或破坏了代码块，已放弃，请重试" }, { status: 502 });
    }
    return NextResponse.json({ content: clean });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 修改失败" },
      { status: 503 },
    );
  }
}

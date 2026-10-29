import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chatOnce, getAiStatus } from "@/lib/ai";
import { loadAttachedImage } from "@/lib/cloud/import-assets";
import { applySearchReplaceBlocks } from "@/lib/patch-edit";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

// 取消原 12,000 字上限，支持长文精准 SEARCH/REPLACE 局部补丁与全量编辑，支持最高 300,000 字
const AI_EDIT_MAX_CHARS = 300_000;
const countFences = (text: string) => (text.match(/```/g) ?? []).length;

// POST /api/articles/[id]/ai-edit — 按指令 AI 修改文章内容（只返回修改稿，应用由客户端走 PATCH）
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await readJsonObject<{
    instruction?: string;
    selection?: string;
    attachments?: Array<{
      name?: string;
      type?: "document" | "image";
      content?: string;
      ref?: string;
      dataUrl?: string;
    }>;
  }>(req);
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
      { error: `文档超过 ${AI_EDIT_MAX_CHARS.toLocaleString()} 字，请划选特定段落后再行修改` },
      { status: 413 },
    );
  }
  const status = await getAiStatus();
  if (!status.available) {
    return NextResponse.json({ error: `AI 未就绪：${status.detail}` }, { status: 503 });
  }

  const selection = body.selection?.trim();
  const attachmentBlocks: string[] = [];
  const visionImages: string[] = [];
  if (Array.isArray(body.attachments)) {
    for (const att of body.attachments) {
      if (!att || typeof att !== "object") continue;
      const name = typeof att.name === "string" ? att.name : "未命名附件";
      if (att.type === "document" && typeof att.content === "string") {
        attachmentBlocks.push(`【用户附带的参考文档：${name}】\n${att.content.slice(0, 15_000)}`);
      } else if (att.type === "image") {
        if (typeof att.ref === "string") {
          attachmentBlocks.push(`【用户附带的图片已存入知识库，引用标记：${att.ref}（文件名：${name}）】\n若修改要求插入或引用该图，请在正文相应位置嵌入 ${att.ref}。`);
        }
        if (typeof att.dataUrl === "string" && att.dataUrl.startsWith("data:image/")) {
          visionImages.push(att.dataUrl);
        } else if (typeof att.name === "string") {
          const loaded = loadAttachedImage(att.name);
          if (loaded) visionImages.push(loaded);
        }
      }
    }
  }

  const isLongArticle = original.length > 8000;
  const isTargetedInstruction =
    /(?:删除|去掉|去除|删掉|移除|清空|抹掉|删去|替换|改成|改为|插入|加一段|修改第|修改标题|h[1-6]|标题)/.test(instruction);

  try {
    const proposed = await chatOnce({
      system: [
        "你是专业的知识库文章编辑 Agent。根据用户的指令修改给出的 Markdown 文章。",
        "【修改原则与格式处理】",
        "1. 严格遵照用户指令修改。如果用户要求删除、修改、降级或替换原有的字体样式、Markdown 格式或标题级别（例如：删除 h2/h3 标题、将标题转为普通正文、去掉加粗/斜体/引用块等），必须坚决执行用户指令，不要因“保持结构”而强行保留用户要求删除的样式或标题！",
        "2. 未提及修改的段落保持原文的语言、语气和内容；代码块、mermaid 图、表格、链接除指令明确要求修改外原样保留；",
        "【输出格式规范】",
        isLongArticle || isTargetedInstruction
          ? [
              "由于文章可能篇幅较长或修改为局部调整，为防止大模型全量输出截断丢失内容，你应当优先使用精准的 SEARCH/REPLACE 块返回局部修改（可提供多个修改块）：",
              "<<<<<<< SEARCH",
              "[原文中需要被替换或删除的精确文本片段，必须与原文完全一致]",
              "=======",
              "[替换后的新文本内容；若用户的意图是删除该段或删除该标题样式，此处留空]",
              ">>>>>>> REPLACE",
              "不要在 SEARCH/REPLACE 块之外输出长篇解释。",
            ].join("\n")
          : [
              "你可以直接输出修改后的完整 Markdown 全文（不要输出任何解释性文字，不要把全文包进代码围栏）；",
              "也可以使用精准的 SEARCH/REPLACE 块返回局部修改：",
              "<<<<<<< SEARCH",
              "[待替换原文]",
              "=======",
              "[替换后文本，删除留空]",
              ">>>>>>> REPLACE",
            ].join("\n"),
        selection ? "用户同时引用了一段原文，指令里的“这段/它”等指代以引用的原文为准。" : "",
        attachmentBlocks.length > 0 ? "用户附带了参考文档或图片附件，请结合附件内容修改，或按指示在合适位置嵌入 ![[图片名]]。" : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      messages: [
        {
          role: "user",
          content: [
            `文章标题：${article.title}`,
            selection ? `引用的原文（附前后文）：\n${selection}` : "",
            attachmentBlocks.length > 0 ? attachmentBlocks.join("\n\n") : "",
            `修改指令：${instruction}`,
            `文章全文：\n\n${original}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          images: visionImages.length > 0 ? visionImages : undefined,
        },
      ],
      maxTokens: 8000,
    });

    const patched = applySearchReplaceBlocks(original, proposed);
    let clean = "";
    if (patched.count > 0) {
      clean = patched.content.trim();
    } else {
      clean = proposed
        .trim()
        // 模型偶尔无视指令把全文包进围栏，剥掉成对的首尾围栏行
        .replace(/^```[a-zA-Z0-9_-]*\n/, "")
        .replace(/\n```$/, "");
    }

    if (!clean) throw new Error("AI 未返回有效修改内容");

    const isDeleteInstruction = /(?:删除|去掉|去除|删掉|移除|清空|抹掉|删去)/.test(instruction);
    const minRatio = isDeleteInstruction ? 0.05 : 0.35;
    if (clean.length < original.length * minRatio) {
      return NextResponse.json({ error: "修改结果不完整（过短），已放弃，请重试" }, { status: 502 });
    }

    // 围栏数量必须成对且不少于原文（除非指令明确要求删代码块）
    if (!/(?:代码|围栏|block).*(?:删|去)/.test(instruction)) {
      if (countFences(clean) < countFences(original) || countFences(clean) % 2 !== 0) {
        return NextResponse.json({ error: "修改结果破坏了代码块结构，已放弃，请重试" }, { status: 502 });
      }
    }

    return NextResponse.json({ content: clean });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 修改失败" },
      { status: 503 },
    );
  }
}

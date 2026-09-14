import { NextRequest, NextResponse } from "next/server";
import { chatAboutArticle, getAiStatus, type ChatTurn } from "@/lib/ai";

// POST /api/ai/ask — 围绕文章的多轮流式问答
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    articleTitle?: string;
    articleContent?: string;
    selection?: string;
    history?: ChatTurn[];
  };

  const history = Array.isArray(body.history) ? body.history : [];
  if (!body.articleTitle || history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "articleTitle 与 user 结尾的 history 必填" }, { status: 400 });
  }

  const status = await getAiStatus();
  if (!status.available) {
    return NextResponse.json({ error: `AI 未就绪：${status.detail}` }, { status: 503 });
  }

  try {
    const stream = await chatAboutArticle({
      articleTitle: body.articleTitle,
      articleContent: body.articleContent,
      selection: body.selection,
      history,
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI 请求失败" },
      { status: 502 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { summarizeArticle } from "@/lib/ai";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

export async function POST(req: NextRequest) {
  const body = await readJsonObject<{ content?: string }>(req);
  if (!body) return invalidJsonResponse();
  const { content } = body;

  if (!content) {
    return NextResponse.json(
      { error: "content is required" },
      { status: 400 }
    );
  }

  try {
    const stream = await summarizeArticle(content);
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "AI_NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "AI 未配置。请在设置页配置 API Key。" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

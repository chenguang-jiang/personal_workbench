import { NextRequest, NextResponse } from "next/server";
import { explainText } from "@/lib/ai";

export async function POST(req: NextRequest) {
  const { text, context, question, content } = await req.json();

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const stream = await explainText(text, context, question, content);
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "AI_NOT_CONFIGURED") {
      return NextResponse.json(
        {
          error:
            "AI 未配置。请在设置页配置 OPENAI_API_KEY，或使用本地 Ollama（http://localhost:11434）。",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

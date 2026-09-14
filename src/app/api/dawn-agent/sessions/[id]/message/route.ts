import { NextRequest, NextResponse } from "next/server";
import { dawnAgentRuntime } from "@/lib/dawn-agent-runtime";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { content?: string };
    const content = body.content?.trim();
    if (!content) return NextResponse.json({ error: "请输入任务" }, { status: 400 });
    await dawnAgentRuntime.prompt(id, content.slice(0, 20_000));
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "任务启动失败" },
      { status: 409 },
    );
  }
}

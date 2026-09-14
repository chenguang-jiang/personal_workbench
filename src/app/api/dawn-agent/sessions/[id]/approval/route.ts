import { NextRequest, NextResponse } from "next/server";
import { dawnAgentRuntime } from "@/lib/dawn-agent-runtime";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      approvalId?: string;
      decision?: "approved" | "denied";
      selectedHunkIds?: string[];
    };
    if (!body.approvalId || !["approved", "denied"].includes(body.decision ?? "")) {
      return NextResponse.json({ error: "审批参数无效" }, { status: 400 });
    }
    const selectedHunkIds = Array.isArray(body.selectedHunkIds)
      ? body.selectedHunkIds.filter((item) => /^h\d+$/.test(item)).slice(0, 40)
      : undefined;
    await dawnAgentRuntime.decide(id, body.approvalId, body.decision!, selectedHunkIds);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "审批失败" },
      { status: 409 },
    );
  }
}

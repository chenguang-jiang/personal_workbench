import { NextRequest, NextResponse } from "next/server";
import { dawnAgentRuntime } from "@/lib/dawn-agent-runtime";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await dawnAgentRuntime.abort(id);
  return NextResponse.json({ stopped: true });
}

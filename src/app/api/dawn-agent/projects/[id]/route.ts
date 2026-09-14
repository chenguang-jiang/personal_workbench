import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dawnAgentRuntime } from "@/lib/dawn-agent-runtime";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sessions = await prisma.dawnAgentSession.findMany({
    where: { projectId: id },
    select: { id: true },
  });
  for (const session of sessions) dawnAgentRuntime.dispose(session.id);
  await prisma.dawnAgentProject.update({
    where: { id },
    data: { enabled: false },
  });
  return NextResponse.json({ success: true });
}

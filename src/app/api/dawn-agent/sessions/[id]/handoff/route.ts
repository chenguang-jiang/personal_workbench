import { NextRequest, NextResponse } from "next/server";
import { appendHandoffContext } from "@/lib/dawn-agent-context";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { handoffId?: string };
  if (!body.handoffId)
    return NextResponse.json({ error: "缺少交接内容" }, { status: 400 });
  const [session, handoff] = await Promise.all([
    prisma.dawnAgentSession.findUnique({ where: { id } }),
    prisma.dawnAgentHandoff.findUnique({ where: { id: body.handoffId } }),
  ]);
  if (!session)
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (!handoff)
    return NextResponse.json({ error: "交接内容不存在" }, { status: 404 });
  if (handoff.status === "accepted" && handoff.sessionId === session.id) {
    return NextResponse.json({ success: true });
  }
  if (handoff.status !== "pending") {
    return NextResponse.json(
      { error: "交接内容已处理，不能再次接入" },
      { status: 409 },
    );
  }
  await prisma.$transaction([
    prisma.dawnAgentSession.update({
      where: { id },
      data: {
        context: appendHandoffContext(session.context, handoff) as never,
      },
    }),
    prisma.dawnAgentHandoff.update({
      where: { id: handoff.id },
      data: {
        status: "accepted",
        projectId: session.projectId,
        sessionId: session.id,
        acceptedAt: new Date(),
      },
    }),
  ]);
  return NextResponse.json({ success: true });
}

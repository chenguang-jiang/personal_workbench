import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendHandoffContext } from "@/lib/dawn-agent-context";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessions = await prisma.dawnAgentSession.findMany({
    where: { projectId: id },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ sessions });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const project = await prisma.dawnAgentProject.findFirst({
    where: { id, enabled: true },
  });
  if (!project)
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    thinkingLevel?: string;
    handoffId?: string;
    permissionMode?: string;
  };
  const handoff = body.handoffId
    ? await prisma.dawnAgentHandoff.findUnique({
        where: { id: body.handoffId },
      })
    : null;
  if (body.handoffId && !handoff) {
    return NextResponse.json({ error: "交接内容不存在" }, { status: 404 });
  }
  if (handoff && handoff.status !== "pending") {
    return NextResponse.json(
      { error: "交接内容已处理，不能再次接入" },
      { status: 409 },
    );
  }
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.dawnAgentSession.create({
      data: {
        projectId: id,
        title:
          body.title?.trim().slice(0, 80) ||
          handoff?.sourceTitle.slice(0, 80) ||
          "新的 Agent 任务",
        context: handoff
          ? (appendHandoffContext(null, handoff) as never)
          : undefined,
        thinkingLevel: [
          "off",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ].includes(body.thinkingLevel ?? "")
          ? body.thinkingLevel!
          : "high",
        permissionMode:
          body.permissionMode === "full_control"
            ? "full_control"
            : "supervised",
      },
    });
    if (handoff) {
      await tx.dawnAgentHandoff.update({
        where: { id: handoff.id },
        data: {
          status: "accepted",
          projectId: id,
          sessionId: created.id,
          acceptedAt: new Date(),
        },
      });
    }
    return created;
  });
  await prisma.dawnAgentProject.update({
    where: { id },
    data: { lastOpenedAt: new Date() },
  });
  return NextResponse.json(session, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dawnAgentRuntime } from "@/lib/dawn-agent-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await prisma.dawnAgentSession.findUnique({
    where: { id },
    include: {
      project: true,
      events: { orderBy: { sequence: "desc" }, take: 400 },
      approvals: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!session)
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json({
    ...session,
    events: [...session.events].reverse(),
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    permissionMode?: string;
  };
  if (!body.permissionMode) {
    return NextResponse.json(
      { error: "没有可更新的权限设置" },
      { status: 400 },
    );
  }
  if (!["supervised", "full_control"].includes(body.permissionMode)) {
    return NextResponse.json({ error: "权限模式无效" }, { status: 400 });
  }
  const session = await prisma.dawnAgentSession.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!session)
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  const permissionMode = body.permissionMode as "supervised" | "full_control";
  const updated = await prisma.dawnAgentSession.update({
    where: { id },
    data: { permissionMode },
  });
  await dawnAgentRuntime.setPermissionMode(id, permissionMode);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  dawnAgentRuntime.dispose(id);
  await prisma.dawnAgentSession.deleteMany({ where: { id } });
  return NextResponse.json({ success: true });
}

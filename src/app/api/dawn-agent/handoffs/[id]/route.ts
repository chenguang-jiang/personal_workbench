import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const handoff = await prisma.dawnAgentHandoff.findUnique({ where: { id } });
  if (!handoff) return NextResponse.json({ error: "交接内容不存在" }, { status: 404 });
  return NextResponse.json(handoff);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (body.status !== "dismissed") {
    return NextResponse.json({ error: "只允许暂不处理待交接内容" }, { status: 400 });
  }
  const result = await prisma.dawnAgentHandoff.updateMany({
    where: { id, status: "pending" },
    data: { status: "dismissed" },
  });
  if (!result.count) return NextResponse.json({ error: "交接内容不存在或已处理" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.dawnAgentHandoff.deleteMany({ where: { id } });
  return NextResponse.json({ success: true });
}

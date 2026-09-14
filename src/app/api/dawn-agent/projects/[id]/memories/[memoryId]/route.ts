import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const KINDS = ["fact", "decision", "preference", "workflow"];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; memoryId: string }> }) {
  const { id, memoryId } = await ctx.params;
  const body = (await req.json()) as { enabled?: boolean; title?: string; content?: string; kind?: string };
  const memory = await prisma.dawnAgentMemory.findFirst({ where: { id: memoryId, projectId: id } });
  if (!memory) return NextResponse.json({ error: "项目记忆不存在" }, { status: 404 });
  const updated = await prisma.dawnAgentMemory.update({
    where: { id: memoryId },
    data: {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      title: body.title?.trim().slice(0, 120) || undefined,
      content: body.content?.trim().slice(0, 12_000) || undefined,
      kind: KINDS.includes(body.kind ?? "") ? body.kind : undefined,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; memoryId: string }> }) {
  const { id, memoryId } = await ctx.params;
  await prisma.dawnAgentMemory.deleteMany({ where: { id: memoryId, projectId: id } });
  return NextResponse.json({ success: true });
}

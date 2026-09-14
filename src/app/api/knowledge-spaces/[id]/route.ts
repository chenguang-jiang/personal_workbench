import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseKnowledgeScope } from "@/lib/knowledge-grounding";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    name?: string;
    description?: string | null;
    scope?: unknown;
    isDefault?: boolean;
  };
  if (body.isDefault) await prisma.knowledgeSpace.updateMany({ data: { isDefault: false } });
  const space = await prisma.knowledgeSpace.update({
    where: { id },
    data: {
      ...(typeof body.name === "string" ? { name: body.name.trim().slice(0, 80) } : {}),
      ...(body.description !== undefined
        ? { description: body.description?.trim().slice(0, 500) || null }
        : {}),
      ...(body.scope !== undefined ? { scope: parseKnowledgeScope(body.scope) } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    },
  });
  return NextResponse.json(space);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const space = await prisma.knowledgeSpace.findUnique({
    where: { id },
    include: { _count: { select: { brainstormSessions: true } } },
  });
  if (!space) return NextResponse.json({ error: "知识空间不存在" }, { status: 404 });
  if (space.isDefault) return NextResponse.json({ error: "默认知识空间不能删除" }, { status: 409 });
  await prisma.knowledgeSpace.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

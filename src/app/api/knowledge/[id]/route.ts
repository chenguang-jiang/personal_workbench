import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/knowledge/[id] — 获取知识节点详情
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const node = await prisma.knowledgeNode.findUnique({
    where: { id },
    include: {
      parent: true,
      children: true,
      relations: { include: { toNode: true } },
      relationsTo: { include: { fromNode: true } },
    },
  });

  if (!node) {
    return NextResponse.json({ error: "节点不存在" }, { status: 404 });
  }

  return NextResponse.json(node);
}

// PATCH /api/knowledge/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const node = await prisma.knowledgeNode.update({
    where: { id },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.parentId !== undefined && { parentId: body.parentId }),
    },
  });

  return NextResponse.json(node);
}

// DELETE /api/knowledge/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.knowledgeNode.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

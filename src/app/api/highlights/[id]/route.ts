import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// DELETE /api/highlights/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.highlight.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

// PATCH /api/highlights/[id] — 更新标注（如添加笔记）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const highlight = await prisma.highlight.update({
    where: { id },
    data: {
      ...(body.note !== undefined && { note: body.note }),
      ...(body.color !== undefined && { color: body.color }),
    },
  });

  return NextResponse.json(highlight);
}

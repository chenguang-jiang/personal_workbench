import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NOTE_NODE_TYPE, noteNodeTitle } from "../note-node";

// DELETE /api/notes/[id] — 删除笔记，并回收创建时同步生成的知识节点（避免图谱残留孤立点）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const note = await tx.note.findUnique({ where: { id } });
      if (!note) return false;
      await tx.note.delete({ where: { id } });
      // 同内容笔记可能有多条：只回收一个对应节点
      const node = await tx.knowledgeNode.findFirst({
        where: {
          userId: note.userId,
          type: NOTE_NODE_TYPE,
          title: noteNodeTitle(note.content),
          content: note.content,
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (node) await tx.knowledgeNode.delete({ where: { id: node.id } });
      return true;
    });
    if (!deleted) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[notes] 删除笔记失败:", error);
    return NextResponse.json({ error: "删除笔记失败" }, { status: 500 });
  }
}

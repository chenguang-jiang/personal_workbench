import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NOTE_NODE_TYPE, noteNodeTitle } from "./note-node";

const DEFAULT_USER_EMAIL = "creator@workbench.local";

async function getDefaultUserId() {
  const user = await prisma.user.findUnique({
    where: { email: DEFAULT_USER_EMAIL },
  });
  return user?.id ?? "";
}

// POST /api/notes — 创建笔记（同时自动创建知识节点到素材库）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "笔记内容不能为空" }, { status: 400 });
  }
  const articleId = typeof body?.articleId === "string" && body.articleId ? body.articleId : null;
  const userId = await getDefaultUserId();
  if (!userId) {
    return NextResponse.json({ error: "默认用户不存在" }, { status: 500 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const note = await tx.note.create({
        data: {
          content,
          quote: typeof body.quote === "string" && body.quote.trim() ? body.quote.trim() : null,
          articleId,
          userId,
        },
      });

      // 同步创建知识节点（笔记自动进入素材库）；删除笔记时按 userId + type + title + content 匹配回收
      await tx.knowledgeNode.create({
        data: {
          title: noteNodeTitle(content),
          content,
          type: NOTE_NODE_TYPE,
          tags: ["笔记"],
          userId,
        },
      });

      return note;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("[notes] 创建笔记失败:", error);
    return NextResponse.json({ error: "创建笔记失败" }, { status: 500 });
  }
}

// GET /api/notes?articleId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const articleId = searchParams.get("articleId");

  const notes = await prisma.note.findMany({
    where: articleId ? { articleId } : undefined,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(notes);
}

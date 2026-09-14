import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_USER_EMAIL = "creator@workbench.local";

async function getDefaultUserId() {
  const user = await prisma.user.findUnique({
    where: { email: DEFAULT_USER_EMAIL },
  });
  return user?.id ?? "";
}

// POST /api/notes — 创建笔记（同时自动创建知识节点到素材库）
export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = await getDefaultUserId();

  const result = await prisma.$transaction(async (tx) => {
    const note = await tx.note.create({
      data: {
        content: body.content,
        quote: typeof body.quote === "string" && body.quote.trim() ? body.quote.trim() : null,
        articleId: body.articleId,
        userId,
      },
    });

    // 同步创建知识节点（笔记自动进入素材库）
    await tx.knowledgeNode.create({
      data: {
        title: body.content.substring(0, 50) + (body.content.length > 50 ? "..." : ""),
        content: body.content,
        type: "note",
        tags: ["笔记"],
        userId,
      },
    });

    return note;
  });

  return NextResponse.json(result, { status: 201 });
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

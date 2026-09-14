import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/highlights — 创建标注（含位置信息）
export async function POST(req: NextRequest) {
  const body = await req.json();

  const highlight = await prisma.highlight.create({
    data: {
      text: body.text,
      color: body.color || "yellow",
      note: body.note,
      // 位置信息（原文变化时可恢复）
      prefix: body.prefix || "",
      suffix: body.suffix || "",
      startOffset: body.startOffset,
      endOffset: body.endOffset,
      articleId: body.articleId,
    },
  });

  return NextResponse.json(highlight, { status: 201 });
}

// GET /api/highlights?articleId=xxx — 获取文章的标注
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const articleId = searchParams.get("articleId");

  const highlights = await prisma.highlight.findMany({
    where: articleId ? { articleId } : undefined,
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(highlights);
}

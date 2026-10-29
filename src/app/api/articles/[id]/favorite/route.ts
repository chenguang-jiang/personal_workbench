import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/articles/[id]/favorite — 切换收藏状态，返回切换后的状态
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const article = await prisma.article.findUnique({
    where: { id },
    select: { id: true, favoritedAt: true },
  });
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  const favorited = article.favoritedAt === null;
  const updated = await prisma.article.update({
    where: { id },
    data: { favoritedAt: favorited ? new Date() : null },
    select: { id: true, favoritedAt: true },
  });
  return NextResponse.json({ favorited, favoritedAt: updated.favoritedAt });
}

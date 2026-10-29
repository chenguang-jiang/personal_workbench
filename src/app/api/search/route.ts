import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { folderFromUrl, loadNodeTagsByTitle, searchKnowledge } from "@/lib/knowledge-search";
import type { SearchHit } from "@/lib/search";

const DEFAULT_USER_EMAIL = "creator@workbench.local";

// GET /api/search?q=...&limit=12 — 加权模糊搜索（标题>标签>文件夹>正文）
// q 为空时返回最近更新的文章（recent 模式）
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(searchParams.get("limit") ?? 12) || 12, 30);

  try {
    const user = await prisma.user.findUnique({ where: { email: DEFAULT_USER_EMAIL } });
    if (!user) return NextResponse.json({ hits: [] as SearchHit[] });

    if (q) return NextResponse.json({ hits: await searchKnowledge(q, limit) });

    // 最近模式：数据库排序 + take，只取需要的字段
    const articles = await prisma.article.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, url: true, tags: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    const nodeTagsByTitle = await loadNodeTagsByTitle(
      user.id,
      articles.map((article) => article.title),
    );
    const hits: SearchHit[] = articles.map((article) => ({
      id: article.id,
      title: article.title,
      tags: [...new Set([...article.tags, ...(nodeTagsByTitle.get(article.title) ?? [])])],
      folder: folderFromUrl(article.url),
      updatedAt: article.updatedAt.toISOString(),
      score: 0,
      matched: [] as string[],
    }));
    return NextResponse.json({ hits });
  } catch (error) {
    console.error("[search] 检索失败:", error);
    return NextResponse.json({ hits: [] as SearchHit[], error: "检索失败" }, { status: 500 });
  }
}

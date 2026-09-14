import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { folderFromUrl, searchKnowledge } from "@/lib/knowledge-search";
import type { SearchHit } from "@/lib/search";

const DEFAULT_USER_EMAIL = "creator@workbench.local";

// GET /api/search?q=...&limit=12 — 加权模糊搜索（标题>标签>文件夹>正文）
// q 为空时返回最近更新的文章（recent 模式）
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(searchParams.get("limit") ?? 12) || 12, 30);

  const user = await prisma.user.findUnique({ where: { email: DEFAULT_USER_EMAIL } });
  if (!user) return NextResponse.json({ hits: [] as SearchHit[] });

  let hits: SearchHit[];
  if (q) {
    hits = await searchKnowledge(q, limit);
  } else {
    const [articles, nodes] = await Promise.all([
      prisma.article.findMany({
        where: { userId: user.id },
        select: { id: true, title: true, url: true, tags: true, updatedAt: true },
      }),
      prisma.knowledgeNode.findMany({
        where: { userId: user.id },
        select: { title: true, tags: true },
      }),
    ]);
    const nodeTagsByTitle = new Map<string, string[]>();
    for (const node of nodes) {
      nodeTagsByTitle.set(node.title, [...(nodeTagsByTitle.get(node.title) ?? []), ...node.tags]);
    }
    hits = [...articles]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit)
      .map((article) => ({
        id: article.id,
        title: article.title,
        tags: [...new Set([...article.tags, ...(nodeTagsByTitle.get(article.title) ?? [])])],
        folder: folderFromUrl(article.url),
        updatedAt: article.updatedAt.toISOString(),
        score: 0,
        matched: [] as string[],
      }));
  }

  return NextResponse.json({ hits });
}

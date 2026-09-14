import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/stats — 聚合统计数据
export async function GET() {
  const user = await prisma.user.findUnique({
    where: { email: "creator@workbench.local" },
  });

  if (!user) {
    return NextResponse.json({
      articles: 0,
      knowledgeNodes: 0,
      topics: 0,
      highlights: 0,
      recentArticles: [],
      popularNodes: [],
    });
  }

  const userId = user.id;

  // 并行查询统计
  const [articles, knowledgeNodes, topics, highlights, recentArticles, popularNodes] =
    await Promise.all([
      prisma.article.count({ where: { userId } }),
      prisma.knowledgeNode.count({ where: { userId } }),
      prisma.topic.count({ where: { userId } }),
      prisma.highlight.count({
        where: { article: { userId } },
      }),
      // 最近更新
      prisma.article.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          updatedAt: true,
          source: true,
          readingProgress: true,
        },
      }),
      // 热门知识节点（有标签的优先）
      prisma.knowledgeNode.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          type: true,
          tags: true,
          updatedAt: true,
        },
      }),
    ]);

  // 按类型分布
  const typeDistribution = await prisma.knowledgeNode.groupBy({
    by: ["type"],
    where: { userId },
    _count: { type: true },
  });

  return NextResponse.json({
    articles,
    knowledgeNodes,
    topics,
    highlights,
    typeDistribution,
    recentArticles,
    popularNodes,
  });
}

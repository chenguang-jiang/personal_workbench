import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 1000;

function parseLimit(raw: string | null) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

// GET /api/graph — 获取知识图谱的节点和边
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get("limit"));
  const type = searchParams.get("type");

  try {
    const user = await prisma.user.findUnique({
      where: { email: "creator@workbench.local" },
    });

    if (!user) {
      return NextResponse.json({ nodes: [], edges: [] });
    }

    // 获取节点：最近更新的优先（超出上限时保留活跃内容，而不是最早创建的旧节点）
    const nodes = await prisma.knowledgeNode.findMany({
      where: {
        userId: user.id,
        ...(type && { type }),
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        type: true,
        parentId: true,
        tags: true,
      },
    });
    const nodeIds = new Set(nodes.map((n) => n.id));
    const idList = [...nodeIds];

    // 只查两端都在已选节点内的关系；文章 id 按标题匹配（只取 id/title）
    const [relations, articles] = await Promise.all([
      idList.length
        ? prisma.knowledgeRelation.findMany({
            where: { fromId: { in: idList }, toId: { in: idList } },
            select: { fromId: true, toId: true, type: true },
          })
        : [],
      idList.length
        ? prisma.article.findMany({
            where: { userId: user.id, title: { in: [...new Set(nodes.map((n) => n.title))] } },
            select: { id: true, title: true },
          })
        : [],
    ]);
    const articleIdByTitle = new Map(articles.map((article) => [article.title, article.id]));

    // 构建父子关系边（从 KnowledgeNode 的 parentId）
    const parentEdges = nodes
      .filter((n) => n.parentId && nodeIds.has(n.parentId))
      .map((n) => ({
        from: n.parentId!,
        to: n.id,
        type: "parent",
      }));

    // 只保留两端都在节点集合内的边，否则 vis-network 会丢弃/报错；同时去重
    const seen = new Set<string>();
    const edges = [
      ...relations.map((r) => ({ from: r.fromId, to: r.toId, type: r.type })),
      ...parentEdges,
    ].filter((edge) => {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return false;
      const key = `${edge.from}::${edge.to}::${edge.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.title,
        group: n.type,
        tags: n.tags,
        articleId: articleIdByTitle.get(n.title) ?? null,
      })),
      edges,
    });
  } catch (error) {
    console.error("[graph] 图谱查询失败:", error);
    return NextResponse.json({ error: "图谱查询失败" }, { status: 500 });
  }
}

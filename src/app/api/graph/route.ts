import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/graph — 获取知识图谱的节点和边
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "80");
  const type = searchParams.get("type");

  const user = await prisma.user.findUnique({
    where: { email: "creator@workbench.local" },
  });

  if (!user) {
    return NextResponse.json({ nodes: [], edges: [] });
  }

  // 获取节点
  const nodes = await prisma.knowledgeNode.findMany({
    where: {
      userId: user.id,
      ...(type && { type }),
    },
    take: limit,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      type: true,
      parentId: true,
      tags: true,
    },
  });

  // 获取关系
  const relations = await prisma.knowledgeRelation.findMany({
    where: {
      OR: [
        { fromNode: { userId: user.id } },
        { toNode: { userId: user.id } },
      ],
    },
    select: {
      id: true,
      fromId: true,
      toId: true,
      type: true,
    },
  });

  // 构建父子关系边（从 KnowledgeNode 的 parentId）
  const parentEdges = nodes
    .filter((n) => n.parentId && nodes.some((m) => m.id === n.parentId))
    .map((n) => ({
      from: n.parentId!,
      to: n.id,
      type: "parent",
    }));

  // 只保留两端都在节点集合内的边，否则 vis-network 会丢弃/报错；同时去重
  const nodeIds = new Set(nodes.map((n) => n.id));
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
    })),
    edges,
  });
}

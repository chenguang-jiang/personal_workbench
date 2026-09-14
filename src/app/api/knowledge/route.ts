import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_USER_EMAIL = "creator@workbench.local";

async function getDefaultUserId() {
  const user = await prisma.user.findUnique({
    where: { email: DEFAULT_USER_EMAIL },
  });
  if (!user) {
    const created = await prisma.user.create({
      data: { email: DEFAULT_USER_EMAIL, name: "创作者" },
    });
    return created.id;
  }
  return user.id;
}

// GET /api/knowledge — 获取知识节点列表（素材库统一入口）
// 支持 search / type / tag 筛选
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const type = searchParams.get("type"); // article | note | concept | material
  const tag = searchParams.get("tag");
  const sort = searchParams.get("sort") || "recent"; // recent | hot | alpha

  const userId = await getDefaultUserId();

  const nodes = await prisma.knowledgeNode.findMany({
    where: {
      userId,
      ...(search && {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { content: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(type && { type }),
      ...(tag && { tags: { has: tag } }),
    },
    orderBy: {
      ...(sort === "recent" && { updatedAt: "desc" }),
      ...(sort === "hot" && { createdAt: "desc" }),
      ...(sort === "alpha" && { title: "asc" }),
    },
  });

  const articleCandidates = nodes.length
    ? await prisma.article.findMany({
        where: {
          userId,
          title: { in: [...new Set(nodes.map((node) => node.title))] },
        },
        select: { id: true, title: true, content: true },
      })
    : [];
  const articleByExactContent = new Map(
    articleCandidates.map((article) => [`${article.title}\u0000${article.content || ""}`, article.id]),
  );
  const articleByTitle = new Map(articleCandidates.map((article) => [article.title, article.id]));

  const linkedNodes = nodes
    .map((node) => ({
      ...node,
      articleId:
        articleByExactContent.get(`${node.title}\u0000${node.content || ""}`) ||
        articleByTitle.get(node.title) ||
        null,
    }))
    .filter((node) => node.articleId !== null);

  return NextResponse.json(linkedNodes);
}

// POST /api/knowledge — 创建知识节点
export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = await getDefaultUserId();

  const node = await prisma.knowledgeNode.create({
    data: {
      title: body.title,
      description: body.description,
      content: body.content,
      type: body.type || "material",
      tags: body.tags || [],
      parentId: body.parentId,
      userId,
    },
  });

  return NextResponse.json(node, { status: 201 });
}

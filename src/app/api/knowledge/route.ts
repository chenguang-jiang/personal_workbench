import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

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

// 列表接口返回的字段：不含正文（调用方：素材库、头脑风暴文章选择器，只用元数据 + articleId）
const NODE_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  type: true,
  tags: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
} as const;

// 列表安全上限，防止节点无限增长时一次返回过多
const NODE_LIST_LIMIT = 2000;

// GET /api/knowledge — 获取知识节点列表（素材库统一入口）
// 支持 search / type / tag 筛选
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = (searchParams.get("search") || "").trim();
  const type = searchParams.get("type"); // article | note | concept | material
  const tag = searchParams.get("tag");
  const sort = searchParams.get("sort") || "recent"; // recent | hot | alpha

  try {
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
      select: NODE_LIST_SELECT,
      take: NODE_LIST_LIMIT,
    });

    const articleCandidates = nodes.length
      ? await prisma.article.findMany({
          where: {
            userId,
            title: { in: [...new Set(nodes.map((node) => node.title))] },
          },
          select: { id: true, title: true },
        })
      : [];
    const articleIdsByTitle = new Map<string, string[]>();
    for (const article of articleCandidates) {
      articleIdsByTitle.set(article.title, [...(articleIdsByTitle.get(article.title) ?? []), article.id]);
    }

    // 只有同名文章不唯一时，才按正文精确匹配消歧（仅加载这些少量记录的正文）
    const ambiguousTitles = [...articleIdsByTitle].filter(([, ids]) => ids.length > 1).map(([title]) => title);
    const articleByExactContent = new Map<string, string>();
    const nodeContentById = new Map<string, string>();
    if (ambiguousTitles.length > 0) {
      const ambiguousNodeIds = nodes.filter((node) => ambiguousTitles.includes(node.title)).map((node) => node.id);
      const [ambiguousArticles, ambiguousNodes] = await Promise.all([
        prisma.article.findMany({
          where: { userId, title: { in: ambiguousTitles } },
          select: { id: true, title: true, content: true },
        }),
        prisma.knowledgeNode.findMany({
          where: { id: { in: ambiguousNodeIds } },
          select: { id: true, content: true },
        }),
      ]);
      for (const article of ambiguousArticles) {
        articleByExactContent.set(`${article.title}\u0000${article.content || ""}`, article.id);
      }
      for (const node of ambiguousNodes) nodeContentById.set(node.id, node.content || "");
    }

    const linkedNodes = nodes
      .map((node) => {
        const ids = articleIdsByTitle.get(node.title) ?? [];
        const exact =
          ids.length > 1
            ? articleByExactContent.get(`${node.title}\u0000${nodeContentById.get(node.id) ?? ""}`)
            : undefined;
        // 与原逻辑一致：精确匹配优先，否则取同名文章中的最后一条
        return { ...node, articleId: exact || ids[ids.length - 1] || null };
      })
      .filter((node) => node.articleId !== null);

    return NextResponse.json(linkedNodes);
  } catch (error) {
    console.error("[knowledge] 列表查询失败:", error);
    return NextResponse.json({ error: "知识库查询失败" }, { status: 500 });
  }
}

// POST /api/knowledge — 创建知识节点
export async function POST(req: NextRequest) {
  const body = await readJsonObject<{
    title?: string;
    description?: string;
    content?: string;
    type?: string;
    tags?: string[];
    parentId?: string;
  }>(req);
  if (!body) return invalidJsonResponse();
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  const userId = await getDefaultUserId();

  const node = await prisma.knowledgeNode.create({
    data: {
      title,
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

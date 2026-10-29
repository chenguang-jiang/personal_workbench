import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

const DEFAULT_USER_EMAIL = "creator@workbench.local";

// 列表只返回卡片需要的字段；正文（可达数百 KB）由 /api/articles/[id] 按需加载
const ARTICLE_LIST_SELECT = {
  id: true,
  title: true,
  url: true,
  summary: true,
  source: true,
  tags: true,
  readingProgress: true,
  lastReadAt: true,
  favoritedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { highlights: true, notes: true } },
} as const;

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

// GET /api/articles — 获取文章列表
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const tag = searchParams.get("tag");
  const source = searchParams.get("source");
  const favorites = searchParams.get("favorites") === "1";
  const paginate = searchParams.get("paginate") === "true";

  const userId = await getDefaultUserId();

  const where = {
    userId,
    ...(search && {
      OR: [
        { title: { contains: search, mode: "insensitive" as const } },
        { content: { contains: search, mode: "insensitive" as const } },
      ],
    }),
    ...(tag && { tags: { has: tag } }),
    ...(source && { source }),
    // 收藏夹：只看已收藏的，按收藏时间新在前
    ...(favorites && { favoritedAt: { not: null } }),
  };

  if (paginate) {
    const requestedPage = Number(searchParams.get("page") || 1);
    const requestedPageSize = Number(searchParams.get("pageSize") || 18);
    const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
    const pageSize = Number.isFinite(requestedPageSize)
      ? Math.min(48, Math.max(6, Math.floor(requestedPageSize)))
      : 18;

    const [items, total, current, featured] = await Promise.all([
      prisma.article.findMany({
        where,
        orderBy: favorites ? { favoritedAt: "desc" } : { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ARTICLE_LIST_SELECT,
      }),
      prisma.article.count({ where }),
      prisma.article.findFirst({
        // 按“最近打开过”选取而不是进度>0：滚回顶部的文章进度会归零，但仍该出现在“接着读”里
        where: { ...where, lastReadAt: { not: null } },
        orderBy: [{ lastReadAt: "desc" }, { updatedAt: "desc" }],
        select: ARTICLE_LIST_SELECT,
      }),
      prisma.article.findFirst({
        where,
        orderBy: { updatedAt: "desc" },
        select: ARTICLE_LIST_SELECT,
      }),
    ]);

    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      current: current || featured || null,
    });
  }

  const articles = await prisma.article.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: ARTICLE_LIST_SELECT,
  });

  return NextResponse.json(articles);
}

// POST /api/articles — 创建文章（同时自动创建知识节点到素材库）
export async function POST(req: NextRequest) {
  const body = await readJsonObject<{
    title?: string;
    content?: string;
    summary?: string;
    url?: string;
    source?: string;
    tags?: string[];
  }>(req);
  if (!body) return invalidJsonResponse();
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  const userId = await getDefaultUserId();

  // 使用事务：创建文章 + 对应的知识节点
  const result = await prisma.$transaction(async (tx) => {
    const article = await tx.article.create({
      data: {
        title,
        content: body.content || "",
        summary: body.summary,
        url: body.url,
        source: body.source || "manual",
        tags: body.tags || [],
        userId,
      },
    });

    // 同步创建知识节点（文章自动进入素材库）
    await tx.knowledgeNode.create({
      data: {
        title,
        content: body.content || "",
        description: body.summary,
        type: "article",
        tags: body.tags || [],
        userId,
      },
    });

    return article;
  });

  return NextResponse.json(result, { status: 201 });
}

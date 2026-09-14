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

// GET /api/articles — 获取文章列表
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const tag = searchParams.get("tag");
  const source = searchParams.get("source");
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
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: {
            select: { highlights: true, notes: true },
          },
        },
      }),
      prisma.article.count({ where }),
      prisma.article.findFirst({
        where: { ...where, readingProgress: { gt: 0 } },
        orderBy: [{ lastReadAt: "desc" }, { updatedAt: "desc" }],
        include: {
          _count: {
            select: { highlights: true, notes: true },
          },
        },
      }),
      prisma.article.findFirst({
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          _count: {
            select: { highlights: true, notes: true },
          },
        },
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
    include: {
      _count: {
        select: { highlights: true, notes: true },
      },
    },
  });

  return NextResponse.json(articles);
}

// POST /api/articles — 创建文章（同时自动创建知识节点到素材库）
export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = await getDefaultUserId();

  // 使用事务：创建文章 + 对应的知识节点
  const result = await prisma.$transaction(async (tx) => {
    const article = await tx.article.create({
      data: {
        title: body.title,
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
        title: body.title,
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

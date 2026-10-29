import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/articles/[id]/share — 查询分享状态
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const article = await prisma.article.findUnique({
    where: { id },
    select: { shareToken: true },
  });
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  return NextResponse.json({ shared: article.shareToken !== null, token: article.shareToken });
}

// POST /api/articles/[id]/share — { enabled: true } 开启分享（生成令牌），false 关闭（清除令牌）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let enabled: unknown;
  try {
    ({ enabled } = await req.json());
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled 必须是布尔值" }, { status: 400 });
  }
  const article = await prisma.article.findUnique({
    where: { id },
    select: { shareToken: true },
  });
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }
  if (!enabled) {
    const cleared = await prisma.article.update({
      where: { id },
      data: { shareToken: null },
      select: { shareToken: true },
    });
    return NextResponse.json({ shared: false, token: cleared.shareToken });
  }
  // 已开启则复用原令牌，避免每次点「分享」都让旧链接失效
  if (article.shareToken) {
    return NextResponse.json({ shared: true, token: article.shareToken });
  }
  const token = randomBytes(12).toString("base64url");
  const updated = await prisma.article.update({
    where: { id },
    data: { shareToken: token },
    select: { shareToken: true },
  });
  return NextResponse.json({ shared: true, token: updated.shareToken });
}

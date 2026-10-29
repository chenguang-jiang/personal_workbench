import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ShareArticleView } from "@/components/share/ShareArticleView";

// 分享页永远读库渲染最新版：禁用任何静态化/缓存
export const dynamic = "force-dynamic";

type SharePageProps = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { token } = await params;
  const article = await prisma.article.findUnique({
    where: { shareToken: token },
    select: { title: true, summary: true },
  });
  if (!article) return { title: "分享不存在" };
  return {
    title: article.title,
    description: article.summary || undefined,
    // 分享页不应被搜索引擎收录
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params;
  const article = await prisma.article.findUnique({
    where: { shareToken: token },
    select: {
      title: true,
      content: true,
      summary: true,
      tags: true,
      updatedAt: true,
    },
  });
  if (!article) notFound();

  return (
    <ShareArticleView
      token={token}
      title={article.title}
      summary={article.summary}
      tags={article.tags}
      updatedAt={article.updatedAt.toISOString()}
      content={article.content || ""}
    />
  );
}

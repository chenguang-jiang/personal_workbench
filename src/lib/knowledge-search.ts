import path from "path";
import { prisma } from "@/lib/prisma";
import { runSearch, type SearchDoc, type SearchHit } from "@/lib/search";

const DEFAULT_USER_EMAIL = "creator@workbench.local";

export function folderFromUrl(url: string | null): string {
  if (!url?.startsWith("obsidian://")) return "";
  const rel = decodeURIComponent(url.slice("obsidian://".length));
  const dir = path.posix.dirname(rel.replace(/\\/g, "/"));
  return dir.replace(/^JCG\//, "").replace(/^JCG$/, "");
}

/** 在知识库（文章标题/标签/文件夹/正文）中加权模糊检索，供搜索 API 与头脑风暴共用 */
export async function searchKnowledge(q: string, limit = 8): Promise<SearchHit[]> {
  const user = await prisma.user.findUnique({ where: { email: DEFAULT_USER_EMAIL } });
  if (!user) return [];

  const [articles, nodes] = await Promise.all([
    prisma.article.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, url: true, tags: true, content: true, updatedAt: true },
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

  const docs: SearchDoc[] = articles.map((article) => ({
    id: article.id,
    title: article.title,
    tags: [...new Set([...article.tags, ...(nodeTagsByTitle.get(article.title) ?? [])])],
    folder: folderFromUrl(article.url),
    content: article.content ?? "",
    updatedAt: article.updatedAt,
  }));

  return runSearch(docs, q, limit);
}

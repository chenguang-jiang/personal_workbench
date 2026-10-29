import path from "path";
import { prisma } from "@/lib/prisma";
import { runSearch, type SearchDoc, type SearchHit } from "@/lib/search";

const DEFAULT_USER_EMAIL = "creator@workbench.local";
// 每个词在正文里的命中候选上限：正文匹配在 Postgres 内完成，只回传 id
const CONTENT_MATCH_LIMIT = 300;
const MAX_QUERY_TOKENS = 6;

export function folderFromUrl(url: string | null): string {
  if (!url?.startsWith("obsidian://")) return "";
  const rel = decodeURIComponent(url.slice("obsidian://".length));
  const dir = path.posix.dirname(rel.replace(/\\/g, "/"));
  return dir.replace(/^JCG\//, "").replace(/^JCG$/, "");
}

/** 汇总知识节点标签（按标题对齐文章），搜索与最近列表共用 */
export async function loadNodeTagsByTitle(userId: string, titles?: string[]) {
  const nodes = await prisma.knowledgeNode.findMany({
    where: { userId, ...(titles && { title: { in: titles } }) },
    select: { title: true, tags: true },
  });
  const nodeTagsByTitle = new Map<string, string[]>();
  for (const node of nodes) {
    nodeTagsByTitle.set(node.title, [...(nodeTagsByTitle.get(node.title) ?? []), ...node.tags]);
  }
  return nodeTagsByTitle;
}

/** 在知识库（文章标题/标签/文件夹/正文）中加权模糊检索，供搜索 API 与头脑风暴共用 */
export async function searchKnowledge(q: string, limit = 8): Promise<SearchHit[]> {
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return [];
  const user = await prisma.user.findUnique({ where: { email: DEFAULT_USER_EMAIL } });
  if (!user) return [];

  // 只取元数据（不含正文）做标题/标签/文件夹的模糊评分；正文命中由 Postgres 预筛，只回传 id
  const [articles, nodeTagsByTitle, contentHits] = await Promise.all([
    prisma.article.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, url: true, tags: true, updatedAt: true },
    }),
    loadNodeTagsByTitle(user.id),
    Promise.all(
      tokens.map(async (token) => {
        const rows = await prisma.article.findMany({
          where: { userId: user.id, content: { contains: token, mode: "insensitive" } },
          select: { id: true },
          orderBy: { updatedAt: "desc" },
          take: CONTENT_MATCH_LIMIT,
        });
        return [token.toLowerCase(), new Set(rows.map((row) => row.id))] as const;
      }),
    ),
  ]);
  const contentIdsByToken = new Map(contentHits);

  const docs: SearchDoc[] = articles.map((article) => ({
    id: article.id,
    title: article.title,
    tags: [...new Set([...article.tags, ...(nodeTagsByTitle.get(article.title) ?? [])])],
    folder: folderFromUrl(article.url),
    content: "",
    updatedAt: article.updatedAt,
    contentHas: (token) => contentIdsByToken.get(token)?.has(article.id) ?? false,
  }));

  return runSearch(docs, tokens.join(" "), limit);
}

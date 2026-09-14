import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { folderFromUrl } from "@/lib/knowledge-search";

export type KnowledgeScope = {
  type: "vault" | "selection";
  folders: string[];
  articleIds: string[];
};

export type KnowledgeCitation = {
  id: string;
  articleId: string;
  path: string;
  title: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  score: number;
};

const DEFAULT_SCOPE: KnowledgeScope = { type: "vault", folders: [], articleIds: [] };

export function parseKnowledgeScope(value: unknown): KnowledgeScope {
  if (!value || typeof value !== "object") return DEFAULT_SCOPE;
  const scope = value as Record<string, unknown>;
  return {
    type: scope.type === "selection" ? "selection" : "vault",
    folders: Array.isArray(scope.folders)
      ? scope.folders.filter((item): item is string => typeof item === "string").slice(0, 30)
      : [],
    articleIds: Array.isArray(scope.articleIds)
      ? scope.articleIds.filter((item): item is string => typeof item === "string").slice(0, 200)
      : [],
  };
}

export async function ensureDefaultKnowledgeSpace() {
  const existing = await prisma.knowledgeSpace.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.knowledgeSpace.create({
    data: {
      name: "整个 Obsidian 知识库",
      description: "默认检索当前同步到 DawnKB 的全部 Obsidian 文档。",
      isDefault: true,
      scope: DEFAULT_SCOPE,
    },
  });
}

function splitIntoChunks(content: string, target = 1200, overlap = 160) {
  const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];
  let cursor = 0;
  while (cursor < content.length) {
    let end = Math.min(content.length, cursor + target);
    if (end < content.length) {
      const candidates = [
        content.lastIndexOf("\n\n", end),
        content.lastIndexOf("\n", end),
        content.lastIndexOf("。", end),
      ].filter((index) => index > cursor + Math.floor(target * 0.55));
      if (candidates.length) end = Math.max(...candidates) + 1;
    }
    const text = content.slice(cursor, end).trim();
    if (text) chunks.push({ content: text, startOffset: cursor, endOffset: end });
    if (end >= content.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }
  return chunks;
}

export async function reindexKnowledge() {
  const articles = await prisma.article.findMany({
    where: { content: { not: null } },
    select: { id: true, title: true, url: true, content: true, tags: true },
  });
  let chunkCount = 0;
  for (const article of articles) {
    const content = article.content?.trim() ?? "";
    const chunks = content ? splitIntoChunks(content) : [];
    await prisma.$transaction([
      prisma.knowledgeChunk.deleteMany({ where: { articleId: article.id } }),
      ...chunks.map((chunk, chunkIndex) =>
        prisma.knowledgeChunk.create({
          data: {
            articleId: article.id,
            vaultPath: article.url?.startsWith("obsidian://")
              ? decodeURIComponent(article.url.slice("obsidian://".length))
              : null,
            title: article.title,
            chunkIndex,
            content: chunk.content,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            contentHash: createHash("sha256").update(chunk.content).digest("hex"),
            tags: article.tags,
          },
        }),
      ),
    ]);
    chunkCount += chunks.length;
  }
  return { articles: articles.length, chunks: chunkCount };
}

function tokensOf(input: string): string[] {
  const normalized = input.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = normalized.split(/\s+/).filter((token) => token.length > 1);
  const chinese = [...normalized.matchAll(/[\p{Script=Han}]{2,}/gu)]
    .flatMap(([value]) => Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
  return [...new Set([...words, ...chinese])].slice(0, 48);
}

function inScope(
  chunk: { articleId: string; vaultPath: string | null },
  scope: KnowledgeScope,
) {
  if (scope.type === "vault") return true;
  if (scope.articleIds.includes(chunk.articleId)) return true;
  const path = (chunk.vaultPath ?? "").replace(/\\/g, "/");
  return scope.folders.some((folder) => path === folder || path.startsWith(`${folder.replace(/\/$/, "")}/`));
}

export async function searchKnowledgeChunks(
  query: string,
  scopeValue: unknown,
  limit = 8,
): Promise<KnowledgeCitation[]> {
  const scope = parseKnowledgeScope(scopeValue);
  let chunks = await prisma.knowledgeChunk.findMany({
    select: {
      id: true,
      articleId: true,
      vaultPath: true,
      title: true,
      content: true,
      startOffset: true,
      endOffset: true,
      tags: true,
      article: { select: { url: true } },
    },
    take: 8000,
  });
  if (chunks.length === 0) {
    await reindexKnowledge();
    chunks = await prisma.knowledgeChunk.findMany({
      select: {
        id: true,
        articleId: true,
        vaultPath: true,
        title: true,
        content: true,
        startOffset: true,
        endOffset: true,
        tags: true,
        article: { select: { url: true } },
      },
      take: 8000,
    });
  }
  const tokens = tokensOf(query);
  if (tokens.length === 0) return [];
  return chunks
    .filter((chunk) => inScope(chunk, scope))
    .map((chunk) => {
      const title = chunk.title.toLowerCase();
      const content = chunk.content.toLowerCase();
      const folder = folderFromUrl(chunk.article.url).toLowerCase();
      const tags = chunk.tags.join(" ").toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (title.includes(token)) score += 8;
        if (tags.includes(token)) score += 5;
        if (folder.includes(token)) score += 4;
        const occurrences = content.split(token).length - 1;
        score += Math.min(occurrences, 8) * 1.5;
      }
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 12)))
    .map(({ chunk, score }, index) => ({
      id: `S${index + 1}`,
      articleId: chunk.articleId,
      path: chunk.vaultPath ?? chunk.article.url ?? "",
      title: chunk.title,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      quote: chunk.content.slice(0, 1600),
      score: Number(score.toFixed(2)),
    }));
}

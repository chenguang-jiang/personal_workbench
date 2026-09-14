import "server-only";

import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { listVaultFolders, resolveVaultPath } from "@/lib/obsidian-vault";

const JCG_URL_PREFIX = "obsidian://JCG/";

type DashboardArticle = {
  id: string;
  title: string;
  url: string | null;
  content: string | null;
  tags: string[];
  updatedAt: Date;
  createdAt: Date;
  _count: { notes: number; highlights: number };
};

export type DashboardActivity = {
  id: string;
  title: string;
  folder: string;
  updatedAt: string;
};

export type GraphPreviewNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  kind: "hub" | "new" | "normal";
};

export type GraphPreview = {
  nodes: GraphPreviewNode[];
  edges: Array<{ x1: number; y1: number; x2: number; y2: number }>;
};

export type DashboardData = {
  vaultName: string;
  articleCount: number;
  folderCount: number;
  tagCount: number;
  linkCount: number;
  annotationCount: number;
  updatedThisWeek: number;
  linkedArticleCount: number;
  annotatedArticleCount: number;
  updatedThisMonth: number;
  recent: DashboardActivity[];
  fresh: DashboardActivity[];
  graphPreview: GraphPreview;
};

function getSourcePath(url: string | null) {
  if (!url?.startsWith("obsidian://")) return "JCG";
  const relativePath = url.slice("obsidian://".length);
  const folder = path.posix.dirname(relativePath);
  return folder === "." ? "JCG" : folder;
}

// 文件出生时间：编辑/移动/改名都不变，才是“新沉淀”的真实信号；DB createdAt 会被移动重置
function getFileBornAt(article: DashboardArticle) {
  if (!article.url?.startsWith("obsidian://")) return article.createdAt;
  try {
    const relativePath = article.url.slice("obsidian://".length);
    const resolved = resolveVaultPath(relativePath);
    const birthtime = fs.statSync(resolved.absolutePath).birthtime;
    return birthtime.getTime() > 0 ? birthtime : article.createdAt;
  } catch {
    return article.createdAt;
  }
}

// 以文件 mtime 为准（阅读进度等 DB 更新不算“更新”，不能污染最近列表）
function getFileModifiedAt(article: DashboardArticle) {
  if (!article.url?.startsWith("obsidian://")) return article.updatedAt;
  try {
    const relativePath = article.url.slice("obsidian://".length);
    const resolved = resolveVaultPath(relativePath);
    return fs.statSync(resolved.absolutePath).mtime;
  } catch {
    return article.updatedAt;
  }
}

function countWikiLinks(content: string | null) {
  if (!content) return 0;
  return Array.from(content.matchAll(/\[\[([^\]|#]+)/g)).length;
}

const PREVIEW_NODE_LIMIT = 22;

// 从真实关系表里取连接度最高的节点子图，做确定性力导向布局，作为“正在生长”预览
async function buildGraphPreview(
  scoped: Array<{ title: string; modifiedAt: Date }>,
  oneWeekAgo: number,
): Promise<GraphPreview> {
  const [nodes, relations] = await Promise.all([
    prisma.knowledgeNode.findMany({ select: { id: true, title: true } }),
    prisma.knowledgeRelation.findMany({ select: { fromId: true, toId: true } }),
  ]);

  const mtimeByTitle = new Map(scoped.map((item) => [item.title, item.modifiedAt]));
  const titleById = new Map(nodes.map((node) => [node.id, node.title]));
  const scopedIds = new Set(
    nodes.filter((node) => mtimeByTitle.has(node.title)).map((node) => node.id),
  );

  const degree = new Map<string, number>();
  for (const relation of relations) {
    if (relation.fromId === relation.toId) continue;
    if (!scopedIds.has(relation.fromId) || !scopedIds.has(relation.toId)) continue;
    degree.set(relation.fromId, (degree.get(relation.fromId) ?? 0) + 1);
    degree.set(relation.toId, (degree.get(relation.toId) ?? 0) + 1);
  }

  const selected = [...scopedIds]
    .filter((id) => (degree.get(id) ?? 0) > 0)
    .sort(
      (a, b) =>
        (degree.get(b) ?? 0) - (degree.get(a) ?? 0) ||
        (titleById.get(a) ?? "").localeCompare(titleById.get(b) ?? ""),
    )
    .slice(0, PREVIEW_NODE_LIMIT);
  if (selected.length < 2) return { nodes: [], edges: [] };

  const selectedIndex = new Map(selected.map((id, index) => [id, index]));
  const edgeKeys = new Set<number>();
  const edges: Array<[number, number]> = [];
  for (const relation of relations) {
    const a = selectedIndex.get(relation.fromId);
    const b = selectedIndex.get(relation.toId);
    if (a === undefined || b === undefined || a === b) continue;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const key = lo * 100000 + hi;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push([lo, hi]);
  }

  const count = selected.length;
  const posX = new Array<number>(count);
  const posY = new Array<number>(count);
  selected.forEach((_id, index) => {
    const angle = (index / count) * Math.PI * 2;
    posX[index] = 50 + 30 * Math.cos(angle);
    posY[index] = 50 + 30 * Math.sin(angle);
  });

  const iterations = 240;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const forceX = new Array<number>(count).fill(0);
    const forceY = new Array<number>(count).fill(0);
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const dx = posX[i] - posX[j];
        const dy = posY[i] - posY[j];
        const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const push = 320 / (distance * distance);
        forceX[i] += (dx / distance) * push;
        forceY[i] += (dy / distance) * push;
        forceX[j] -= (dx / distance) * push;
        forceY[j] -= (dy / distance) * push;
      }
    }
    for (const [a, b] of edges) {
      const dx = posX[b] - posX[a];
      const dy = posY[b] - posY[a];
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const pull = (distance - 16) * 0.03;
      forceX[a] += (dx / distance) * pull;
      forceY[a] += (dy / distance) * pull;
      forceX[b] -= (dx / distance) * pull;
      forceY[b] -= (dy / distance) * pull;
    }
    const step = 1 - iteration / iterations;
    for (let i = 0; i < count; i += 1) {
      forceX[i] += (50 - posX[i]) * 0.02;
      forceY[i] += (50 - posY[i]) * 0.02;
      posX[i] += Math.max(-4, Math.min(4, forceX[i] * step));
      posY[i] += Math.max(-4, Math.min(4, forceY[i] * step));
    }
  }

  const minX = Math.min(...posX);
  const maxX = Math.max(...posX);
  const minY = Math.min(...posY);
  const maxY = Math.max(...posY);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = (value: number, min: number, span: number, offset: number, size: number) =>
    Number((offset + ((value - min) / span) * size).toFixed(2));

  const hubIds = new Set(selected.slice(0, 3));
  const maxDegree = Math.max(...selected.map((id) => degree.get(id) ?? 0), 1);
  const previewNodes: GraphPreviewNode[] = selected.map((id, index) => {
    const title = titleById.get(id) ?? "";
    const modifiedAt = mtimeByTitle.get(title);
    const nodeDegree = degree.get(id) ?? 0;
    return {
      id,
      label: title,
      x: scale(posX[index], minX, spanX, 10, 80),
      y: scale(posY[index], minY, spanY, 12, 76),
      r: Number((1.7 + (nodeDegree / maxDegree) * 2.5).toFixed(2)),
      kind:
        modifiedAt && modifiedAt.getTime() >= oneWeekAgo
          ? "new"
          : hubIds.has(id)
            ? "hub"
            : "normal",
    };
  });

  return {
    nodes: previewNodes,
    edges: edges.map(([a, b]) => ({
      x1: previewNodes[a].x,
      y1: previewNodes[a].y,
      x2: previewNodes[b].x,
      y2: previewNodes[b].y,
    })),
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  await connection();
  const articles = await prisma.article.findMany({
    where: { source: "obsidian", url: { startsWith: JCG_URL_PREFIX } },
    select: {
      id: true,
      title: true,
      url: true,
      content: true,
      tags: true,
      updatedAt: true,
      createdAt: true,
      _count: { select: { notes: true, highlights: true } },
    },
  });

  const folders = listVaultFolders().filter(
    (folder) => folder.path.startsWith("JCG/") && folder.fileCount > 0,
  );
  const datedArticles = articles
    .map((article) => ({ article, modifiedAt: getFileModifiedAt(article) }))
    .sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime());
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const tagCount = new Set(articles.flatMap((article) => article.tags)).size;
  const linkCounts = articles.map((article) => countWikiLinks(article.content));

  return {
    vaultName: resolveVaultPath().vaultName || "Obsidian",
    articleCount: articles.length,
    folderCount: folders.length,
    tagCount,
    linkCount: linkCounts.reduce((total, count) => total + count, 0),
    annotationCount: articles.reduce(
      (total, article) => total + article._count.notes + article._count.highlights,
      0,
    ),
    updatedThisWeek: datedArticles.filter(({ modifiedAt }) => modifiedAt.getTime() >= oneWeekAgo).length,
    linkedArticleCount: linkCounts.filter((count) => count > 0).length,
    annotatedArticleCount: articles.filter(
      (article) => article._count.notes + article._count.highlights > 0,
    ).length,
    updatedThisMonth: datedArticles.filter(({ modifiedAt }) => modifiedAt.getTime() >= oneMonthAgo).length,
    graphPreview: await buildGraphPreview(
      datedArticles.map(({ article, modifiedAt }) => ({ title: article.title, modifiedAt })),
      oneWeekAgo,
    ),
    recent: datedArticles.slice(0, 6).map(({ article, modifiedAt }) => ({
      id: article.id,
      title: article.title,
      folder: getSourcePath(article.url),
      updatedAt: modifiedAt.toISOString(),
    })),
    // 最近沉淀 = 新写进 vault 的文档（按文件出生时间），与“最近更新（按修改时间）”语义区分
    fresh: articles
      .map((article) => ({ article, bornAt: getFileBornAt(article) }))
      .sort((a, b) => b.bornAt.getTime() - a.bornAt.getTime())
      .slice(0, 3)
      .map(({ article, bornAt }) => ({
        id: article.id,
        title: article.title,
        folder: getSourcePath(article.url),
        updatedAt: bornAt.toISOString(),
      })),
  };
}

import matter from "gray-matter";
import { prisma } from "@/lib/prisma";
import type { OrganizeItem } from "./types";

/**
 * 确定性扫描：不花 token，把全库文档过一遍，产出三类信号 ——
 * 重复（精确 + 近似）、疑似无用、待归类候选。AI 只负责给归类候选挑目录，
 * 重复/无用的判定全部来自可解释的确定性规则，且删除都走可恢复回收站。
 */

const NEAR_DUP_THRESHOLD = 0.92;
const USELESS_BODY_CHARS = 80;
const UNTITLED_PATTERN = /^(未命名文档|无标题|untitled)(\s*[-–—]?\s*\d*)?$/i;

/** 交给 AI 分类的候选文档 */
export type ClassifyCandidate = {
  id: string;
  articleId: string;
  title: string;
  /** 相对 Vault 根路径 */
  path: string;
  /** 当前所在目录（相对 Vault 根） */
  folder: string;
  /** 正文摘录，供 AI 判断主题 */
  excerpt: string;
};

export type ScanResult = {
  items: OrganizeItem[];
  classifyCandidates: ClassifyCandidate[];
  scanned: number;
};

type DocRow = {
  id: string;
  title: string;
  url: string | null;
  content: string | null;
  updatedAt: Date;
  _count: { highlights: number; notes: number };
};

/** 剥掉 frontmatter 与 Markdown 语法噪声后的正文字符数 */
function bodyOf(raw: string): string {
  const { content } = matter(raw);
  return content;
}

function plainText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[[^\]]*\]\]|\[\[[^\]|]*\|?([^\]]*)\]\]/g, " $1 ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/[#>*_`~|:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeContent(content: string): string {
  return plainText(bodyOf(content)).toLocaleLowerCase();
}

/** 中文 2-gram + 英文词的去重 token 集合（同 knowledge-grounding 的 tokensOf，但不截断） */
function tokenSet(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = normalized.split(/\s+/).filter((token) => token.length > 1);
  const chinese = [...normalized.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap(([value]) =>
    Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)),
  );
  return new Set([...words, ...chinese]);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  // 上界短路：|A∩B|/|A∪B| ≤ min/max，达不到阈值就不用算交集
  if (small.size / large.size < NEAR_DUP_THRESHOLD) return 0;
  let intersection = 0;
  for (const token of small) if (large.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function vaultRelPath(url: string | null): string | null {
  if (!url?.startsWith("obsidian://")) return null;
  const rel = decodeURIComponent(url.slice("obsidian://".length));
  return rel.endsWith(".md") ? rel : null;
}

function folderOf(relPath: string): string {
  const index = relPath.lastIndexOf("/");
  return index === -1 ? "" : relPath.slice(0, index);
}

/** 重复簇里选保留项：有标注/笔记的优先 → 正文最长 → 最近更新 */
function keeperRank(doc: DocRow, bodyLength: number): [number, number, number] {
  const annotated = doc._count.highlights + doc._count.notes > 0 ? 1 : 0;
  return [annotated, bodyLength, doc.updatedAt.getTime()];
}

function compareRank(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export async function scanOrganizeCandidates(): Promise<ScanResult> {
  const docs = (await prisma.article.findMany({
    where: { source: "obsidian", url: { startsWith: "obsidian://" } },
    select: {
      id: true, title: true, url: true, content: true, updatedAt: true,
      _count: { select: { highlights: true, notes: true } },
    },
    orderBy: { updatedAt: "desc" },
  })) as DocRow[];

  type Prepared = { doc: DocRow; relPath: string; body: string; normalized: string; tokens: Set<string> };
  const prepared: Prepared[] = [];
  for (const doc of docs) {
    const relPath = vaultRelPath(doc.url);
    if (!relPath) continue;
    const body = bodyOf(doc.content || "");
    prepared.push({ doc, relPath, body, normalized: normalizeContent(doc.content || ""), tokens: tokenSet(plainText(body)) });
  }

  const items: OrganizeItem[] = [];
  const claimed = new Set<string>();
  // 建议删除的条目集合：归类候选要排除它们（重复簇的保留项仍可参与归类）
  const doomed = new Set<string>();

  const makeDeleteItem = (
    entry: Prepared,
    kind: "duplicate" | "useless",
    reason: string,
    confidence: number,
    defaultChecked: boolean,
  ): OrganizeItem => ({
    id: `${kind}-${entry.doc.id}`,
    kind,
    action: "delete",
    articleId: entry.doc.id,
    title: entry.doc.title,
    vaultPath: entry.relPath,
    reason,
    confidence,
    defaultChecked,
  });

  // ---- 1. 完全重复：归一化正文精确相等 ----
  const byContent = new Map<string, Prepared[]>();
  for (const entry of prepared) {
    if (!entry.normalized) continue;
    const list = byContent.get(entry.normalized);
    if (list) list.push(entry);
    else byContent.set(entry.normalized, [entry]);
  }
  for (const cluster of byContent.values()) {
    if (cluster.length < 2) continue;
    addDuplicateCluster(cluster, "与《{keeper}》内容完全相同", 0.99, true, items, claimed, doomed);
  }

  // ---- 2. 高度相似：2-gram Jaccard > 0.92（长度比先短路） ----
  const sorted = [...prepared].filter((entry) => entry.tokens.size > 0 && !claimed.has(entry.doc.id));
  sorted.sort((a, b) => b.tokens.size - a.tokens.size);
  for (let i = 0; i < sorted.length; i += 1) {
    if (claimed.has(sorted[i].doc.id)) continue;
    const cluster = [sorted[i]];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const other = sorted[j];
      if (claimed.has(other.doc.id)) continue;
      // 尺寸降序排列后，一旦比例低于阈值，后面的更小、更不可能达标
      if (other.tokens.size / sorted[i].tokens.size < NEAR_DUP_THRESHOLD) break;
      if (jaccard(sorted[i].tokens, other.tokens) >= NEAR_DUP_THRESHOLD) cluster.push(other);
    }
    if (cluster.length >= 2) {
      addDuplicateCluster(cluster, "与《{keeper}》内容高度相似（正文重合度超过 92%）", 0.9, false, items, claimed, doomed);
    }
  }

  // ---- 3. 疑似无用：正文过短 / 未命名 / 空占位页 ----
  for (const entry of prepared) {
    if (claimed.has(entry.doc.id)) continue;
    if (entry.doc._count.highlights + entry.doc._count.notes > 0) continue; // 有标注就不算无用
    const text = plainText(entry.body);
    const untitled = UNTITLED_PATTERN.test(entry.doc.title.trim());
    if (untitled && text.length < USELESS_BODY_CHARS * 4) {
      items.push(makeDeleteItem(entry, "useless", "标题为未命名文档且几乎没有正文内容", 0.9, false));
      claimed.add(entry.doc.id);
      doomed.add(entry.doc.id);
    } else if (text.length === 0) {
      items.push(makeDeleteItem(entry, "useless", "正文为空，只剩标题或 frontmatter", 0.95, true));
      claimed.add(entry.doc.id);
      doomed.add(entry.doc.id);
    } else if (text.length < USELESS_BODY_CHARS) {
      items.push(makeDeleteItem(entry, "useless", `正文只有 ${text.length} 个字，疑似占位或残页`, 0.85, false));
      claimed.add(entry.doc.id);
      doomed.add(entry.doc.id);
    }
  }

  // ---- 4. 归类候选：Inbox、Vault 根与 JCG 根散落的文件 ----
  const classifyCandidates: ClassifyCandidate[] = [];
  for (const entry of prepared) {
    if (doomed.has(entry.doc.id)) continue;
    const folder = folderOf(entry.relPath);
    const isStray = folder === "" || folder === "JCG" || folder.endsWith("/00-Inbox") || folder === "00-Inbox";
    if (!isStray) continue;
    classifyCandidates.push({
      id: `reclassify-${entry.doc.id}`,
      articleId: entry.doc.id,
      title: entry.doc.title,
      path: entry.relPath,
      folder: folder || "(Vault 根目录)",
      excerpt: plainText(entry.body).slice(0, 500),
    });
  }
  // Inbox 最优先，其次根目录散落，最后按更新时间
  classifyCandidates.sort((a, b) => {
    const rank = (c: ClassifyCandidate) => (c.folder.includes("00-Inbox") ? 0 : c.folder.startsWith("(") || c.folder === "JCG" ? 1 : 2);
    return rank(a) - rank(b) || b.articleId.localeCompare(a.articleId);
  });

  return { items, classifyCandidates, scanned: prepared.length };
}

/** 重复簇 → 保留一份，其余列为待删；带标注/笔记的成员一律不删 */
function addDuplicateCluster(
  cluster: { doc: DocRow; relPath: string }[],
  reasonTemplate: string,
  confidence: number,
  defaultChecked: boolean,
  items: OrganizeItem[],
  claimed: Set<string>,
  doomed: Set<string>,
) {
  const live = cluster.filter((entry) => !claimed.has(entry.doc.id));
  if (live.length < 2) return;
  const ranked = live
    .map((entry) => ({ entry, rank: keeperRank(entry.doc, (entry.doc.content || "").length) }))
    .sort((a, b) => compareRank(b.rank, a.rank));
  const keeper = ranked[0].entry;
  // 保留项之外的成员如果带标注/笔记，也不动它（数据比整洁更重要）
  const deletable = ranked.slice(1).filter(
    ({ entry }) => entry.doc._count.highlights + entry.doc._count.notes === 0,
  );
  claimed.add(keeper.doc.id);
  if (deletable.length === 0) return;
  for (const { entry } of deletable) {
    items.push({
      id: `duplicate-${entry.doc.id}`,
      kind: "duplicate",
      action: "delete",
      articleId: entry.doc.id,
      title: entry.doc.title,
      vaultPath: entry.relPath,
      reason: reasonTemplate.replace("{keeper}", keeper.doc.title),
      confidence,
      defaultChecked,
    });
    claimed.add(entry.doc.id);
    doomed.add(entry.doc.id);
  }
}

/**
 * 加权模糊搜索
 *
 * 字段权重：标题 ×5 > 标签 ×4 > 文件夹 ×2.5 > 正文 ×1
 * 匹配方式：完全相等 100 > 前缀 70 > 子串 40 > 模糊子序列 12（正文仅子串 6）
 * 多词查询取 AND：每个词都必须在某字段命中，文档才入选。
 */

export interface SearchDoc {
  id: string;
  title: string;
  tags: string[];
  folder: string;
  content: string;
  updatedAt: Date;
}

export interface SearchHit {
  id: string;
  title: string;
  tags: string[];
  folder: string;
  updatedAt: string;
  score: number;
  matched: string[];
}

const WEIGHT = { title: 5, tag: 4, folder: 2.5, content: 1 } as const;

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j += 1) {
    if (hay[j] === needle[i]) i += 1;
  }
  return i === needle.length;
}

/** 单个字段对单个词的匹配分（0 表示未命中） */
function fieldScore(token: string, field: string): number {
  if (!field) return 0;
  if (field === token) return 100;
  if (field.startsWith(token)) return 70;
  if (field.includes(token)) return 40;
  if (token.length >= 2 && isSubsequence(token, field)) return 12;
  return 0;
}

export function scoreDoc(doc: SearchDoc, tokens: string[]): SearchHit | null {
  const title = doc.title.toLowerCase();
  const folder = doc.folder.toLowerCase();
  const tags = doc.tags.map((tag) => tag.toLowerCase());
  const content = doc.content.toLowerCase();

  let total = 0;
  const matched = new Set<string>();

  for (const raw of tokens) {
    const token = raw.toLowerCase();
    if (!token) continue;

    const titleScore = fieldScore(token, title) * WEIGHT.title;
    const tagScore = Math.max(0, ...tags.map((tag) => fieldScore(token, tag))) * WEIGHT.tag;
    const folderScore = fieldScore(token, folder) * WEIGHT.folder;
    const contentScore = content.includes(token) ? 6 * WEIGHT.content : 0;

    const tokenScore = titleScore + tagScore + folderScore + contentScore;
    if (tokenScore <= 0) return null; // AND 语义：任一词未命中即淘汰

    total += tokenScore;
    if (titleScore > 0) matched.add("title");
    if (tagScore > 0) matched.add("tags");
    if (folderScore > 0) matched.add("folder");
    if (contentScore > 0) matched.add("content");
  }

  // 近期更新轻微加权（7 天内 +3）
  const age = Date.now() - doc.updatedAt.getTime();
  if (age < 7 * 24 * 3600 * 1000) total += 3;

  return {
    id: doc.id,
    title: doc.title,
    tags: doc.tags,
    folder: doc.folder,
    updatedAt: doc.updatedAt.toISOString(),
    score: Math.round(total * 10) / 10,
    matched: [...matched],
  };
}

export function runSearch(docs: SearchDoc[], query: string, limit = 12): SearchHit[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return docs
    .map((doc) => scoreDoc(doc, tokens))
    .filter((hit): hit is SearchHit => hit !== null)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

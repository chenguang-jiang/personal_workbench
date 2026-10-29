import type { ClassifyCandidate } from "./scan";
import type { OrganizeItem } from "./types";

/**
 * AI 归类建议的校验层（纯函数，可单测，对标 cloud/import-plan.ts）。
 *
 * 原则："AI proposes, server validates" ——
 * - id 必须命中本批候选，未知 id 直接丢弃；
 * - folder 必须在白名单内且通过安全路径检查；
 * - confidence < 0.72 的归类建议直接丢弃（不降级成"移到 Inbox"，宁可不提议也不乱搬）；
 * - 目标与当前目录相同的建议丢弃；
 * - 理由截断 250 字。
 */

const MIN_CONFIDENCE = 0.72;
const REASON_MAX = 250;

export function safeFolderRelativePath(value: string): boolean {
  if (!value || value.includes("\\") || value.startsWith("/") || /[\x00-\x1f\x7f]/.test(value)) return false;
  return value.split("/").every((part) => part.length > 0 && !part.startsWith(".") && part.trim() === part);
}

type AiClassifyEntry = {
  id?: unknown;
  folder?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

/** 把一批 AI 返回校验为可展示的 OrganizeItem（action=move）；不合格的一律丢弃 */
export function validateClassifyBatch(
  raw: unknown,
  candidates: ClassifyCandidate[],
  folders: string[],
): OrganizeItem[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const items: OrganizeItem[] = [];
  const seen = new Set<string>();

  for (const entry of raw as AiClassifyEntry[]) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = typeof entry.id === "string" ? byId.get(entry.id) : undefined;
    if (!candidate || seen.has(candidate.id)) continue;

    const confidence = typeof entry.confidence === "number" ? entry.confidence : 0;
    const folder = typeof entry.folder === "string" ? entry.folder : "";
    // 白名单 + 安全路径双重校验；不满足或低置信度 → 丢弃，不出现在方案里
    if (!folders.includes(folder) || !safeFolderRelativePath(folder)) continue;
    if (confidence < MIN_CONFIDENCE) continue;

    const fileName = candidate.path.slice(candidate.path.lastIndexOf("/") + 1);
    const targetPath = `${folder}/${fileName}`;
    if (targetPath === candidate.path) continue;

    seen.add(candidate.id);
    const reason =
      typeof entry.reason === "string" && entry.reason.trim()
        ? entry.reason.trim().slice(0, REASON_MAX)
        : "AI 建议按文档主题归入该目录";
    items.push({
      id: candidate.id,
      kind: "reclassify",
      action: "move",
      articleId: candidate.articleId,
      title: candidate.title,
      vaultPath: candidate.path,
      targetPath,
      reason,
      confidence,
      // 只有高置信度建议默认勾选，其余留给用户主动确认
      defaultChecked: confidence >= 0.85,
    });
  }
  return items;
}

/** 从 AI 返回文本中提取 JSON 数组或 {items:[...]} 包装 */
export function parseClassifyJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { items?: unknown } | unknown[];
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)) {
      return (parsed as { items: unknown[] }).items;
    }
    return null;
  } catch {
    return null;
  }
}

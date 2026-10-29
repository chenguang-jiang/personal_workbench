import path from "node:path";
import { createHash } from "node:crypto";
import { safeImportRelativePath } from "./import-plan";

export function isIndexPath(value: string) {
  return /(?:索引|目录|知识库首页|知识库导航|index|readme)\.md$/i.test(path.posix.basename(value));
}

export function selectIndexPaths(documentPath: string, existing: string[], suggested: unknown) {
  const folder = path.posix.dirname(documentPath);
  const safe = existing.filter((item) => item !== documentPath && safeImportRelativePath(item) && isIndexPath(item));
  const ancestors = safe.filter((item) => {
    const parent = path.posix.dirname(item);
    return (parent === folder || folder.startsWith(parent + "/")) && /^(?:index|readme|索引|目录|.*知识库首页|知识库导航)\.md$/i.test(path.posix.basename(item));
  }).sort((a, b) => b.split("/").length - a.split("/").length);
  const chosen = Array.isArray(suggested) ? suggested.filter((item): item is string => typeof item === "string" && safe.includes(item)).slice(0, 2) : [];
  const result = [...new Set([...chosen, ...ancestors.slice(0, 1)])];
  return result.length ? result : [`${folder}/索引.md`];
}

export function upsertIndexEntry(markdown: string, documentPath: string, title: string) {
  const key = createHash("sha256").update(documentPath).digest("hex").slice(0, 20);
  const start = `<!-- dawnkb-entry:${key} -->`;
  const end = `<!-- /dawnkb-entry:${key} -->`;
  const label = title.replace(/[\[\]|\r\n]/g, " ");
  const target = documentPath.replace(/\.md$/i, "");
  const block = `${start}\n- [[${target}|${label}]]\n${end}`;
  const from = markdown.indexOf(start), to = markdown.indexOf(end, from);
  if (from >= 0 && to >= from) return markdown.slice(0, from) + block + markdown.slice(to + end.length);
  // 已有手写链接时保留原布局，不再重复追加。
  if (markdown.includes(`[[${target}]]`) || markdown.includes(`[[${target}|`)) return markdown;
  return markdown.trimEnd() + `\n\n${block}\n`;
}

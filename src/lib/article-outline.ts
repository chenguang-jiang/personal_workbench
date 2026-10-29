export type OutlineItem = {
  id: string;
  level: 2 | 3;
  text: string;
};

export type HeadingState = {
  section: number;
  subsection: number;
};

const RELATED_HEADING = /相关(笔记|文档|链接|资料)|关联(文档|笔记|链接)/;

export function normalizeTitle(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function plainHeading(value: string) {
  return normalizeTitle(
    value.replace(
      /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
      (_match, target: string, alias?: string) => alias || target,
    ),
  );
}

/** 与正文渲染共用的标题编号，保证目录锚点和 DOM id 一致。 */
export function headingIdFor(level: number, state: HeadingState) {
  if (level === 2) {
    state.section += 1;
    return `article-section-${state.section}`;
  }
  if (level === 3) {
    state.subsection += 1;
    return `article-subsection-${state.subsection}`;
  }
  return undefined;
}

function walkMarkdownLines(
  markdown: string,
  onLine: (line: string) => void,
) {
  let fence = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    onLine(line);
  }
}

export function extractArticleOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const state: HeadingState = { section: 0, subsection: 0 };
  walkMarkdownLines(markdown, (line) => {
    const heading = line.trim().match(/^(#{2,3})\s+(.+)$/);
    if (!heading) return;
    const level = heading[1].length as 2 | 3;
    const id = headingIdFor(level, state);
    if (!id || RELATED_HEADING.test(heading[2])) return;
    items.push({ id, level, text: plainHeading(heading[2]) });
  });
  return items;
}

/** 正文是否以与文档标题相同的一级标题开头。这类标题由页眉承担，正文里不再重复显示。 */
export function opensWithDocumentTitle(markdown: string, title: string) {
  let fence = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence || !trimmed) continue;
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (!heading || heading[1].length !== 1) return false;
    return normalizeTitle(heading[2]) === normalizeTitle(title);
  }
  return false;
}

/** 编辑保存时把被页眉收走的开篇标题写回 Markdown，避免 Vault 原文丢标题。 */
export function restoreOmittedTitle(
  markdown: string,
  title: string,
  original: string,
) {
  const cleanTitle = title.trim();
  if (!cleanTitle || !opensWithDocumentTitle(original, cleanTitle)) {
    return markdown;
  }
  if (opensWithDocumentTitle(markdown, cleanTitle)) return markdown;
  return `# ${cleanTitle}\n\n${markdown.trimStart()}`;
}

/** 中文按字、英文按词估算阅读时间。 */
export function readingMinutes(markdown: string) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ");
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = text
    .replace(/[\u3400-\u9fff]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const words = latin ? latin.split(/\s+/).length : 0;
  return Math.max(1, Math.round(cjk / 450 + words / 220));
}

export function articleOrigin(article: {
  source?: string | null;
  url?: string | null;
}) {
  if (article.url?.startsWith("obsidian://")) {
    const relative = decodeURIComponent(article.url.slice("obsidian://".length));
    return relative.split("/").slice(0, -1).pop() || "知识库";
  }
  if (article.source === "manual") return "手记";
  if (article.source === "import") return "导入";
  if (article.source === "rss") return "订阅";
  if (article.source === "daily") return "日报";
  return "晨光知识库";
}

export function articleStamp(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replaceAll("-", ".");
}

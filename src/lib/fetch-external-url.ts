/**
 * 外部 URL 动态抓取器
 *
 * 支持多种抓取策略：
 * 1. 直接 .md 后缀（Gitbook 风格）
 * 2. HTML 文本提取（静态页面）
 * 3. defuddle 内容提取（文章类页面）
 * 4. 带缓存避免重复抓取（30 分钟 TTL）
 */

const cache = new Map<string, { content: string; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟

/** 从 HTML 中提取纯文本 */
function extractTextFromHtml(html: string): string {
  // 去掉 script/style 标签
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    // 把块级标签换行
    .replace(/<\/(?:div|p|h[1-6]|li|tr|section|article|pre|blockquote|table)[^>]*>/gi, "\n")
    .replace(/<(?:br|hr)[^>]*\/?>/gi, "\n")
    // 去掉所有 HTML 标签
    .replace(/<[^>]+>/g, " ")
    // 解码实体
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x20;/g, " ")
    .replace(/&nbsp;/g, " ")
    // 压缩空白
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 如果提取内容太少（< 200 字符），大概率是 SPA，返回空
  if (text.length < 200) return "";

  return text.slice(0, 12000);
}

/** 尝试直接 fetch 一个 URL */
async function tryFetchDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": "DawnKB/1.0 (knowledge-fetcher)",
        Accept: "text/html, text/plain, text/markdown, */*",
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();

    if (contentType.includes("text/markdown") || url.endsWith(".md")) {
      return text.slice(0, 12000);
    }
    if (contentType.includes("text/html") || text.includes("<!DOCTYPE") || text.includes("<html")) {
      return extractTextFromHtml(text);
    }
    // 纯文本或其他
    return text.slice(0, 12000);
  } catch {
    return null;
  }
}

/** 尝试 defuddle 提取 */
async function tryDefuddle(url: string): Promise<string | null> {
  try {
    const { execSync } = await import("node:child_process");
    const result = execSync(`defuddle parse "${url}" --md 2>/dev/null`, {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
    });
    const trimmed = result.trim();
    return trimmed.length > 100 ? trimmed.slice(0, 12000) : null;
  } catch {
    return null;
  }
}

export interface FetchResult {
  url: string;
  content: string | null;
  strategy: string;
  fromCache: boolean;
}

/** 尝试提取 Notion 公开页面内容 */
async function tryNotionApi(url: string): Promise<string | null> {
  try {
    // 从 URL 提取 page ID
    const match = url.match(/notion\.(?:so|site)\/[^/]+-([a-f0-9]{32})/i);
    if (!match) return null;
    const pageId = match[1];
    // 尝试 Notion 公开 API
    const res = await fetch(`https://potion-api.notion.com/v1/page/${pageId}`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        "Notion-Client-Version": "23.10.0.0",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const blocks = data?.recordMap?.block;
    if (!blocks) return null;
    // 提取所有文本内容
    const texts: string[] = [];
    for (const [, block] of Object.entries(blocks) as [string, any][]) {
      const title = block?.value?.properties?.title;
      if (title && Array.isArray(title)) {
        const text = title.map((t: any) => t[0]).join("");
        if (text.trim()) texts.push(text);
      }
    }
    const content = texts.join("\n").trim();
    return content.length > 100 ? content.slice(0, 12000) : null;
  } catch {
    return null;
  }
}

/**
 * 抓取外部 URL 内容（多策略 + 缓存）
 */
export async function fetchExternalUrl(url: string): Promise<FetchResult> {
  // 检查缓存
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { url, content: cached.content, strategy: "cache", fromCache: true };
  }

  let content: string | null = null;
  let strategy = "unknown";

  // 策略 1: 尝试 .md 后缀（Gitbook 风格）
  if (!url.endsWith(".md") && !url.endsWith(".json") && !url.endsWith(".yaml")) {
    const mdUrl = url.replace(/\/$/, "") + ".md";
    content = await tryFetchDirect(mdUrl);
    if (content) {
      strategy = "md-suffix";
      cache.set(url, { content, timestamp: Date.now() });
      return { url, content, strategy, fromCache: false };
    }
  }

  // 策略 2: 直接抓取
  content = await tryFetchDirect(url);
  if (content) {
    strategy = "direct";
    cache.set(url, { content, timestamp: Date.now() });
    return { url, content, strategy, fromCache: false };
  }

  // 策略 3: Notion 公开 API
  if (url.includes("notion.")) {
    content = await tryNotionApi(url);
    if (content) {
      strategy = "notion-api";
      cache.set(url, { content, timestamp: Date.now() });
      return { url, content, strategy, fromCache: false };
    }
  }

  // 策略 4: defuddle
  content = await tryDefuddle(url);
  if (content) {
    strategy = "defuddle";
    cache.set(url, { content, timestamp: Date.now() });
    return { url, content, strategy, fromCache: false };
  }

  return { url, content: null, strategy, fromCache: false };
}

/**
 * 从文章内容中提取"平台名 → URL"映射
 * 识别多种格式：
 * - `- 平台名：[url](url)`  → 平台名取自冒号前的文本
 * - `[标签](url)` → 标签取自链接文本
 * - 纯 URL → 自动提取域名作为标签
 */
export function extractUrlMap(
  articleContent: string,
): Map<string, string> {
  const map = new Map<string, string>();

  // 格式 1: `- 平台名：[link](url)` 或 `- 平台名：URL`
  // 捕获冒号前的中文/英文/数字作为平台名
  const labeledRegex = /(?:^|\n)\s*[-*]\s*([^：:\n]+)[：:]\s*(?:\[([^\]]*)\]\s*)?\((https?:\/\/[^\s)]+)\)/gm;
  let match;
  while ((match = labeledRegex.exec(articleContent)) !== null) {
    const platform = match[1].trim();
    const url = match[3].trim();
    if (url && platform && platform.length > 1) {
      map.set(platform, url);
    }
  }

  // 格式 2: 标准 Markdown 链接 `[text](url)`（未被格式 1 捕获的）
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  while ((match = linkRegex.exec(articleContent)) !== null) {
    const label = match[1].trim();
    const url = match[2].trim();
    if (url && label && label.length > 1 && !label.startsWith("http")) {
      // 避免重复添加
      if (![...map.values()].includes(url)) {
        map.set(label, url);
      }
    }
  }

  // 格式 3: 纯 URL（兜底，用域名作为标签）
  const plainUrlRegex = /(?<![\[(])(https?:\/\/[^\s)]+)/g;
  while ((match = plainUrlRegex.exec(articleContent)) !== null) {
    const url = match[0].trim();
    if (url && ![...map.values()].includes(url)) {
      try {
        const host = new URL(url).hostname.replace("www.", "");
        map.set(host, url);
      } catch {
        map.set(url, url);
      }
    }
  }

  return map;
}

/**
 * 根据查询文本匹配对应的外部 URL
 * 返回匹配到的 [平台名, URL] 列表，按匹配度排序
 */
export function matchQueryToUrls(
  query: string,
  urlMap: Map<string, string>,
): Array<[string, string]> {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/[\s\-/_()]+/).filter((w) => w.length > 1);
  const results: Array<[string, string, number]> = [];

  for (const [label, url] of urlMap) {
    const labelLower = label.toLowerCase();
    const labelWords = labelLower.split(/[\s\-/_()]+/).filter((w) => w.length > 1);

    // 策略 1: 查询整体包含标签名（最精确）
    if (queryLower.includes(labelLower)) {
      results.push([label, url, label.length * 10]);
      continue;
    }

    // 策略 2: 标签名分词 — 每个标签词是否在查询中出现
    const matchedWords = labelWords.filter((lw) =>
      queryWords.some((qw) => lw.includes(qw) || qw.includes(lw)),
    );
    // 至少匹配 1 个有意义的词（长度 > 2 或英文关键词）
    const meaningful = matchedWords.filter(
      (w) => w.length > 2 || /^[a-z]{2,}$/.test(w),
    );
    if (meaningful.length >= 1) {
      // 得分 = 匹配词数 × 5，非域名标签额外加分，单标签词额外加分
      const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(label);
      const boost = (isDomain ? 0 : 3) + (labelWords.length === 1 ? 2 : 0);
      const score = meaningful.length * 5 + boost;
      results.push([label, url, score]);
    }
  }

  // 按匹配度排序，去重 URL
  results.sort((a, b) => b[2] - a[2]);
  const seen = new Set<string>();
  return results
    .filter(([, url]) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, 3)
    .map(([label, url]) => [label, url]);
}

/**
 * 清理缓存（可用于手动刷新）
 */
export function clearFetchCache(): void {
  cache.clear();
}
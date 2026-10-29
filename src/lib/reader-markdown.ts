/**
 * 阅读器 Markdown → HTML 渲染管线（从 Reader.tsx 抽出，供阅读器与公开分享页共用）。
 *
 * 纯函数、无 React 依赖：输入 Markdown 与链接映射，输出转义后的 HTML 字符串。
 * 分享页通过 options 改写图片地址（走带 token 的资产接口）并把 wikilink 降级为
 * 纯文本，避免把站内其它文章的路径泄露给匿名访问者。
 */

import { headingIdFor, type HeadingState } from "@/lib/article-outline";

export type LinkMap = Record<string, string>;

export type RenderOptions = {
  /** 多个 Markdown 片段共用编号，保证篇内目录与标题锚点一致。 */
  headings?: HeadingState;
  /** 站内图片地址生成器；默认走 /api/obsidian/asset */
  assetUrl?: (cleanSrc: string) => string;
  /** 是否把 wikilink 渲染成站内链接；分享页传 false 降级为纯文本 */
  resolveLinks?: boolean;
};

function defaultAssetUrl(cleanSrc: string): string {
  return `/api/obsidian/asset?path=${encodeURIComponent(cleanSrc)}`;
}

export function splitMermaidBlocks(markdown: string) {
  const blocks: Array<{ type: "markdown" | "mermaid"; content: string }> = [];
  const pattern = /```[ \t]*mermaid[ \t]*\n([\s\S]*?)```/gi;
  let cursor = 0;

  for (const match of markdown.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor)
      blocks.push({ type: "markdown", content: markdown.slice(cursor, start) });
    blocks.push({ type: "mermaid", content: match[1] });
    cursor = start + match[0].length;
  }

  if (cursor < markdown.length)
    blocks.push({ type: "markdown", content: markdown.slice(cursor) });
  return blocks.length
    ? blocks
    : [{ type: "markdown" as const, content: markdown }];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

const CJK_CHAR = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

/** 合并软换行：中文与中文之间直接相连，不插入多余空格；其余情况用空格衔接 */
function joinSoftWrapped(parts: string[]): string {
  return parts.reduce((joined, part) => {
    if (!joined) return part;
    if (!part) return joined;
    const glue = CJK_CHAR.test(joined.at(-1) ?? "") && CJK_CHAR.test(part[0]) ? "" : " ";
    return `${joined}${glue}${part}`;
  }, "");
}

function calloutLabel(type: string) {
  const labels: Record<string, string> = {
    abstract: "摘要",
    summary: "摘要",
    tldr: "摘要",
    tip: "提示",
    hint: "提示",
    important: "重点",
    info: "信息",
    note: "笔记",
    todo: "待办",
    success: "完成",
    check: "完成",
    done: "完成",
    question: "问题",
    help: "问题",
    faq: "问题",
    warning: "注意",
    caution: "注意",
    attention: "注意",
    danger: "风险",
    error: "错误",
    failure: "失败",
    fail: "失败",
    bug: "缺陷",
    example: "示例",
    quote: "引用",
    cite: "引用",
  };
  return labels[type] || "补充说明";
}

function vaultLinkHref(
  target: string,
  label: string,
  linkMap: LinkMap,
): string {
  const id = linkMap[target];
  return id ? `/reading/${id}` : `/reading?search=${encodeURIComponent(label)}`;
}

function imageTag(src: string, alt: string, options: RenderOptions): string {
  const cleanSrc = src.trim().replace(/^\.?\//, "");
  const url = /^https?:\/\//i.test(cleanSrc)
    ? cleanSrc
    : (options.assetUrl ?? defaultAssetUrl)(cleanSrc);
  const label = alt.trim() || cleanSrc.split("/").pop() || "image";
  return `<img class="reader-img" loading="lazy" src="${escapeHtml(url)}" alt="${escapeHtml(label)}" />`;
}

/** 引用/callout 正文：空的 > 行分段，段内软换行合并 */
function renderQuoteParagraphs(lines: string[], linkMap: LinkMap, options: RenderOptions): string {
  const paragraphs: string[][] = [[]];
  for (const line of lines) {
    if (line.trim()) paragraphs[paragraphs.length - 1].push(line.trim());
    else if (paragraphs[paragraphs.length - 1].length > 0) paragraphs.push([]);
  }
  return paragraphs
    .filter((group) => group.length > 0)
    .map((group) => `<p>${renderInline(joinSoftWrapped(group), linkMap, options)}</p>`)
    .join("");
}

/** <details>/<summary> 折叠块：默认收起，点击 summary 展开 */
function renderDetailsBlock(source: string, linkMap: LinkMap, options: RenderOptions): string {
  const inner = source
    .replace(/<details[^>]*>/gi, "")
    .replace(/<\/details>/g, "");
  const summaryMatch = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  const summary = summaryMatch
    ? summaryMatch[1].replace(/<[^>]+>/g, "").trim()
    : "展开详情";
  const bodySource = summaryMatch ? inner.replace(summaryMatch[0], "") : inner;
  const body = renderMarkdown(bodySource, linkMap, options);
  return `<details class="reader-details"><summary>${escapeHtml(summary)}</summary><div class="reader-details-body">${body}</div></details>`;
}

function renderListItem(text: string, linkMap: LinkMap, options: RenderOptions): string {
  const task = text.match(/^\[([ xX])\]\s*(.*)$/);
  if (!task) return `<li>${renderInline(text, linkMap, options)}</li>`;
  const done = task[1] !== " ";
  return `<li class="reader-task"><span class="reader-task-box${done ? " reader-task-box--done" : ""}" aria-hidden="true">${done ? "✓" : ""}</span>${renderInline(task[2], linkMap, options)}</li>`;
}

export function renderInline(value: string, linkMap: LinkMap = {}, options: RenderOptions = {}): string {
  const resolveLinks = options.resolveLinks !== false;
  const codeFragments: string[] = [];
  const wikiFragments: string[] = [];
  const embedFragments: string[] = [];
  const brFragments: string[] = [];
  let output = value.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const index = codeFragments.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return `\u0000CODE${index}\u0000`;
  });

  // Unwrap harmless presentation containers after protecting inline code.
  // All other raw HTML continues through escapeHtml below.
  output = output.replace(/<\/?(?:div|span|center)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, "");

  // 表格单元格/行内换行 <br> / <br/> / <br />，转义前占位保护
  output = output.replace(/<br\s*\/?>/gi, () => {
    const index = brFragments.push("<br />") - 1;
    return `\u0000BR${index}\u0000`;
  });

  // Markdown 图片 ![alt](src)
  output = output.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, alt: string, src: string) => {
      const index = embedFragments.push(imageTag(src.split(/\s+/)[0], alt, options)) - 1;
      return `\u0000EMB${index}\u0000`;
    },
  );

  // Obsidian 嵌入 ![[target]]
  output = output.replace(/!\[\[([^\]]+)\]\]/g, (_match, target: string) => {
    const clean = target.trim();
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(clean)) {
      const index =
        embedFragments.push(
          imageTag(
            clean,
            clean
              .split("/")
              .pop()
              ?.replace(/\.[^.]+$/, "") || clean,
            options,
          ),
        ) - 1;
      return `\u0000EMB${index}\u0000`;
    }
    const label = clean.split("/").pop() || clean;
    if (!resolveLinks) {
      const index =
        embedFragments.push(
          `<span class="reader-wikilink reader-wikilink--plain">${escapeHtml(label)}</span>`,
        ) - 1;
      return `\u0000EMB${index}\u0000`;
    }
    const index =
      embedFragments.push(
        `<a class="reader-wikilink" data-resolve="${escapeHtml(clean)}" href="${escapeHtml(vaultLinkHref(clean, label, linkMap))}">${escapeHtml(label)}</a>`,
      ) - 1;
    return `\u0000EMB${index}\u0000`;
  });

  output = output.replace(
    /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, alias?: string) => {
      const label = (alias || target.split("/").pop() || target).trim();
      const resolvedTarget = target.trim();
      if (!resolveLinks) {
        const index =
          wikiFragments.push(
            `<span class="reader-wikilink reader-wikilink--plain">${escapeHtml(label)}</span>`,
          ) - 1;
        return `\u0000WIKI${index}\u0000`;
      }
      const index =
        wikiFragments.push(
          `<a class="reader-wikilink" data-resolve="${escapeHtml(resolvedTarget)}" href="${escapeHtml(vaultLinkHref(resolvedTarget, label, linkMap))}">${escapeHtml(label)}</a>`,
        ) - 1;
      return `\u0000WIKI${index}\u0000`;
    },
  );

  // 普通 Markdown 链接 [text](href)
  output = output.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, text: string, href: string) => {
      const index = /^https?:\/\//i.test(href)
        ? embedFragments.push(
            `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`,
          ) - 1
        : (() => {
            const target = href
              .replace(/^<|>$/g, "")
              .replace(/\.md$/i, "")
              .trim();
            if (!resolveLinks) {
              return (
                embedFragments.push(
                  `<span class="reader-wikilink reader-wikilink--plain">${escapeHtml(text)}</span>`,
                ) - 1
              );
            }
            return (
              embedFragments.push(
                `<a class="reader-wikilink" data-resolve="${escapeHtml(target)}" href="${escapeHtml(vaultLinkHref(target, text, linkMap))}">${escapeHtml(text)}</a>`,
              ) - 1
            );
          })();
      return `\u0000EMB${index}\u0000`;
    },
  );

  output = escapeHtml(output)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>");

  return output
    .replace(
      /\u0000CODE(\d+)\u0000/g,
      (_match, index: string) => codeFragments[Number(index)],
    )
    .replace(
      /\u0000BR(\d+)\u0000/g,
      (_match, index: string) => brFragments[Number(index)],
    )
    .replace(
      /\u0000WIKI(\d+)\u0000/g,
      (_match, index: string) => wikiFragments[Number(index)],
    )
    .replace(
      /\u0000EMB(\d+)\u0000/g,
      (_match, index: string) => embedFragments[Number(index)],
    );
}

/** 覆盖阅读场景常用块级语法，并在插入 DOM 前统一转义原始内容。 */
export function renderMarkdown(md: string, linkMap: LinkMap = {}, options: RenderOptions = {}): string {
  if (!md) return "";

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let inHtmlComment = false;

  function markRelatedDivider() {
    if (output.at(-1) === "<hr />") {
      output[output.length - 1] = '<hr class="reader-related-hr" />';
    }
  }

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const text = joinSoftWrapped(paragraph);
    const isRelated = /^(?:\*\*|__)?(?:相关|关联)(?:文档|笔记|链接|资料)(?:\*\*|__)?\s*[:：]/.test(text);
    if (isRelated) markRelatedDivider();
    output.push(`<p${isRelated ? ' class="reader-related-links"' : ""}>${renderInline(text, linkMap, options)}</p>`);
    paragraph = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (inHtmlComment) {
      const end = line.indexOf("-->");
      if (end < 0) continue;
      line = line.slice(end + 3);
      inHtmlComment = false;
    }
    let trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const language = trimmed
        .slice(3)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "");
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      output.push(
        `<pre${language ? ` data-language="${language}"` : ""}><button type="button" class="code-copy-btn" aria-label="复制代码">复制</button><code>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // Obsidian documents often wrap footers in HTML containers. Ignore only
    // presentation wrappers; never insert source attributes or styles into the DOM.
    // Fenced code was handled above, so its literal HTML remains untouched.
    if (/^<\/?(?:div|center)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>$/i.test(trimmed)) {
      flushParagraph();
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      flushParagraph();
      const end = trimmed.indexOf("-->", 4);
      if (end < 0) {
        inHtmlComment = true;
        continue;
      }
      trimmed = trimmed.slice(end + 3).trim();
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const isRelated = /相关(笔记|文档|链接|资料)|关联(文档|笔记|链接)/.test(
        heading[2],
      );
      if (isRelated) {
        markRelatedDivider();
      }
      const id = options.headings ? headingIdFor(level, options.headings) : undefined;
      const numbered = level === 3 ? heading[2].match(/^(\d+)[.、]\s+(.+)$/) : null;
      const inner = numbered
        ? `<span class="reader-h-index">${escapeHtml(numbered[1])}.</span> ${renderInline(numbered[2], linkMap, options)}`
        : renderInline(heading[2], linkMap, options);
      output.push(
        `<h${level}${id ? ` id="${id}" tabindex="-1"` : ""}${isRelated ? ' class="reader-related-heading"' : ""}>${inner}</h${level}>`,
      );
      continue;
    }

    if (
      index + 1 < lines.length &&
      trimmed.includes("|") &&
      isTableSeparator(lines[index + 1])
    ) {
      flushParagraph();
      const headers = tableCells(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes("|")
      ) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      output.push(
        `<div class="reader-table-wrap"><table><thead><tr>${headers
          .map((cell) => `<th>${renderInline(cell, linkMap, options)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${headers
                .map(
                  (_, cellIndex) =>
                    `<td>${renderInline(row[cellIndex] || "", linkMap, options)}</td>`,
                )
                .join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      // Obsidian callout：> [!type][+/-] 自定义标题，后续行为正文（空 > 行分段）
      const callout = quote[0]?.match(/^\[!([a-z]+)\]([+-]?)\s*(.*)$/i);
      if (callout) {
        const type = callout[1].toLowerCase();
        const customTitle = callout[3].trim();
        const title = customTitle ? renderInline(customTitle, linkMap, options) : calloutLabel(type);
        const body = renderQuoteParagraphs(quote.slice(1), linkMap, options);
        const attrs = `class="reader-callout reader-callout--${escapeHtml(type)}" data-callout="${escapeHtml(type)}"${
          callout[2] ? ` data-fold="${callout[2]}"` : ""
        }${customTitle ? ` data-title="${escapeHtml(customTitle)}"` : ""}`;
        output.push(`<aside ${attrs}><strong><span></span>${title}</strong>${body}</aside>`);
      } else {
        output.push(
          `<blockquote class="reader-quote">${renderQuoteParagraphs(quote, linkMap, options)}</blockquote>`,
        );
      }
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const listTag = ordered ? "ol" : "ul";
      const items: string[] = [];
      const itemPattern = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const raw = lines[index];
        const item = raw.trim().match(itemPattern);
        if (item) {
          items.push(item[1]);
          index += 1;
          continue;
        }
        // 缩进行视为上一个列表项的续行（如长代码折行）
        const continuation = raw.match(/^(?:\s{2,}|\t)(\S.*)$/);
        if (continuation && items.length > 0) {
          items[items.length - 1] = joinSoftWrapped([items[items.length - 1], continuation[1].trim()]);
          index += 1;
          continue;
        }
        // 松散列表：空行后仍是同级列表项则不中断
        if (!raw.trim() && index + 1 < lines.length) {
          const next = lines[index + 1];
          if (next.trim().match(itemPattern) || /^(?:\s{2,}|\t)\S/.test(next)) {
            index += 1;
            continue;
          }
        }
        break;
      }
      index -= 1;
      output.push(
        `<${listTag}>${items.map((text) => renderListItem(text, linkMap, options)).join("")}</${listTag}>`,
      );
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph();
      output.push("<hr />");
      continue;
    }

    if (/^<details\b/i.test(trimmed)) {
      flushParagraph();
      const chunk: string[] = [line];
      let closed = /<\/details>/i.test(trimmed);
      while (!closed && index + 1 < lines.length) {
        index += 1;
        chunk.push(lines[index]);
        closed = /<\/details>/i.test(lines[index]);
      }
      output.push(renderDetailsBlock(chunk.join("\n"), linkMap, options));
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return output.join("\n");
}

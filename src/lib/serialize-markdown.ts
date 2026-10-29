/**
 * 把阅读器渲染出的 .reader-prose DOM 反向序列化回 Markdown，
 * 支持“所见即所得”原位编辑后的保存。
 * 只处理 renderMarkdown 会产出的节点类型，未知节点退化为纯文本。
 */

import { splitQuizOptions } from "./quiz-embed";

function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const inner = () => Array.from(el.childNodes).map(serializeInline).join("");

  switch (el.tagName) {
    case "STRONG":
    case "B":
      return `**${inner()}**`;
    case "EM":
    case "I":
      return `*${inner()}*`;
    case "DEL":
    case "S":
    case "STRIKE":
      return `~~${inner()}~~`;
    case "CODE":
      return `\`${inner()}\``;
    case "MARK":
      return inner();
    case "BR":
      return "\n";
    case "A": {
      const href = el.getAttribute("href") ?? "";
      const label = inner();
      const target = el.getAttribute("data-resolve");
      if (target) {
        const short = target.split("/").pop() || target;
        return label.trim() === short ? `[[${target}]]` : `[[${target}|${label}]]`;
      }
      if (href) return `[${label}](${href})`;
      return label;
    }
    case "IMG": {
      const src = el.getAttribute("src") ?? "";
      const alt = el.getAttribute("alt") ?? "";
      const match = src.match(/[?&]path=([^&]+)/);
      const target = match ? decodeURIComponent(match[1]) : src;
      return target ? `![${alt}](${target})` : "";
    }
    default:
      return inner();
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * 读取代码块文本并保留换行：contentEditable 里回车会生成 <br> 或 <div>，
 * textContent 会把它们压成一行，编辑过的代码块保存前必须先还原换行。
 */
function codeBlockText(code: HTMLElement): string {
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    if (el.tagName === "BR") return "\n";
    const inner = Array.from(el.childNodes).map(walk).join("");
    // 块级容器（div/p）各自独占一行
    if (/^(DIV|P)$/.test(el.tagName)) return `${inner}\n`;
    return inner;
  }
  return Array.from(code.childNodes).map(walk).join("").replace(/\n+$/, "");
}

function serializeBlock(el: HTMLElement): string | null {
  const tag = el.tagName;

  const heading = tag.match(/^H([1-6])$/);
  if (heading) return `${"#".repeat(Number(heading[1]))} ${serializeInlineChildren(el)}`;

  if (tag === "P") {
    const text = serializeInlineChildren(el);
    // 编辑态下连排选项段落未被增强，保存时仍拆回每行一个选项
    const options = splitQuizOptions(text.trim());
    if (options) return options.map((o) => `${o.key}. ${o.text}`).join("\n");
    return text;
  }

  if (tag === "PRE") {
    const language = el.getAttribute("data-language") ?? "";
    const codeEl = el.querySelector<HTMLElement>("code");
    const code = codeEl ? codeBlockText(codeEl) : "";
    return `\`\`\`${language}\n${code}\n\`\`\``;
  }

  if (tag === "HR") return "---";

  if (el.classList.contains("quiz-embed-options")) {
    const parts = Array.from(el.querySelectorAll(":scope > .quiz-embed-option")).map(
      (option) => {
        const key = option.querySelector(".quiz-embed-key")?.textContent?.replace(/\s*[.、]\s*$/, "") ?? "";
        const text = option.querySelector(".quiz-embed-text")?.textContent ?? "";
        return `${key}. ${text.trim()}`;
      },
    );
    return parts.join("\n") || null;
  }

  if (tag === "DETAILS") {
    const summary = el.querySelector(":scope > summary")?.textContent?.trim() ?? "";
    const body = el.querySelector(":scope > .reader-details-body");
    const bodyMd = body
      ? Array.from((body as HTMLElement).children)
          .map((child) => serializeBlock(child as HTMLElement))
          .filter((md): md is string => md !== null)
          .join("\n\n")
      : "";
    return `<details>\n<summary>${summary}</summary>\n\n${bodyMd}\n\n</details>`;
  }

  if (tag === "BLOCKQUOTE") {
    return quoteLines(quoteParagraphs(el)).join("\n");
  }

  if (tag === "ASIDE" && el.classList.contains("reader-callout")) {
    const typeMatch = [...el.classList].join(" ").match(/reader-callout--([\w-]+)/);
    const type = el.dataset.callout ?? typeMatch?.[1] ?? "info";
    const title = el.querySelector<HTMLElement>(":scope > strong");
    // 保留自定义标题（若用户改了标题文字，以编辑后的为准）与折叠标记
    const customTitle = el.dataset.title !== undefined && title ? serializeInlineChildren(title).trim() : "";
    const head = `> [!${type}]${el.dataset.fold ?? ""}${customTitle ? ` ${customTitle}` : ""}`;
    return [head, ...quoteLines(quoteParagraphs(el))].join("\n");
  }

  if (tag === "UL" || tag === "OL") {
    const items = Array.from(el.children)
      .filter((child) => child.tagName === "LI")
      .map((li, index) => {
        const liEl = li as HTMLElement;
        if (liEl.classList.contains("reader-task")) {
          const done = Boolean(liEl.querySelector(".reader-task-box--done"));
          const text = Array.from(liEl.childNodes)
            .filter((child) => !(child instanceof HTMLElement && child.classList.contains("reader-task-box")))
            .map(serializeInline)
            .join("");
          return `${tag === "OL" ? `${index + 1}.` : "-"} [${done ? "x" : " "}] ${text}`;
        }
        return `${tag === "OL" ? `${index + 1}.` : "-"} ${serializeInlineChildren(liEl)}`;
      });
    return items.join("\n");
  }

  if (el.classList.contains("reader-table-wrap")) {
    const table = el.querySelector("table");
    if (!table) return el.textContent ?? "";
    const headCells = Array.from(table.querySelectorAll("thead th")).map((cell) =>
      escapeCell(serializeInlineChildren(cell as HTMLElement)),
    );
    const lines = [`| ${headCells.join(" | ")} |`, `| ${headCells.map(() => "---").join(" | ")} |`];
    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      const cells = Array.from(row.children).map((cell) =>
        escapeCell(serializeInlineChildren(cell as HTMLElement)),
      );
      lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines.join("\n");
  }

  const text = (el.textContent ?? "").trim();
  return text || null;
}

function serializeInlineChildren(el: HTMLElement): string {
  return Array.from(el.childNodes).map(serializeInline).join("");
}

/** 引用块里的段落（每个 <p> 一段；旧结构无 <p> 时整体作为一段） */
function quoteParagraphs(el: HTMLElement): string[] {
  const paragraphs = Array.from(el.querySelectorAll<HTMLElement>(":scope > p"));
  if (paragraphs.length === 0) return [serializeInlineChildren(el)];
  return paragraphs.map((p) => serializeInlineChildren(p));
}

/** 段落之间用空的 > 行分隔，段内换行逐行加 > 前缀 */
function quoteLines(paragraphs: string[]): string[] {
  return paragraphs.flatMap((text, index) => [
    ...(index > 0 ? [">"] : []),
    ...text.split("\n").map((line) => `> ${line}`),
  ]);
}

/**
 * 裸文本节点（contentEditable 里在空文档/块首落笔时 Chrome 直接插文本节点，
 * 不包块级元素）按段落序列化，换行保留为软换行。
 */
function serializeTextNode(node: Node): string | null {
  const text = (node.textContent ?? "").trim();
  return text || null;
}

/** 序列化整篇 .reader-prose（含 mermaid 图块还原） */
export function serializeProse(root: HTMLElement): string {
  const blocks: string[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const md = serializeTextNode(child);
      if (md !== null) blocks.push(md);
      continue;
    }
    const el = child as HTMLElement;
    if (el.classList.contains("mermaid-diagram")) {
      const source = el.getAttribute("data-source") ?? "";
      blocks.push(`\`\`\`mermaid\n${source}\n\`\`\``);
      continue;
    }
    if (el.classList.contains("reader-markdown-fragment")) {
      for (const block of Array.from(el.childNodes)) {
        const md =
          block.nodeType === Node.TEXT_NODE
            ? serializeTextNode(block)
            : serializeBlock(block as HTMLElement);
        if (md !== null) blocks.push(md);
      }
      continue;
    }
    const md = serializeBlock(el);
    if (md !== null) blocks.push(md);
  }
  return blocks.join("\n\n");
}

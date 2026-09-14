/** 轻量 Markdown → HTML，用于 AI 回答气泡（标题/加粗/斜体/行内代码/代码块/列表/引用） */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 行内 Markdown（加粗/斜体/行内代码）→ HTML，用于题干与选项 */
export function renderInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

const isTableDivider = (line: string) =>
  /^\|?\s*:?-{2,}.*\|/.test(line) || /^\|[\s:|-]+\|$/.test(line);

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

export function renderMiniMarkdown(md: string): string {
  const inline = renderInlineMarkdown;

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (trimmed.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1].trim())) {
      flush();
      const header = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      out.push(
        `<table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const bullet = /^[-*•]\s+/.test(trimmed);
    const ordered = /^\d+[.)、]\s+/.test(trimmed);
    if (bullet || ordered) {
      flush();
      const items = [trimmed.replace(/^([-*•]|\d+[.)、])\s+/, "")];
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        const nextMatch = bullet ? /^[-*•]\s+/.test(next) : /^\d+[.)、]\s+/.test(next);
        if (!nextMatch) break;
        i++;
        items.push(next.replace(/^([-*•]|\d+[.)、])\s+/, ""));
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      out.push(`<blockquote>${inline(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return out.join("");
}

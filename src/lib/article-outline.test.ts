import assert from "node:assert/strict";
import test from "node:test";
import { extractArticleOutline } from "./article-outline";
import { renderMarkdown, splitMermaidBlocks, type RenderOptions } from "./reader-markdown";

function renderArticle(markdown: string, options: RenderOptions = {}) {
  const shared = { ...options, headings: { section: 0, subsection: 0 } };
  return splitMermaidBlocks(markdown)
    .map((block) => block.type === "markdown" ? renderMarkdown(block.content, {}, shared) : "")
    .join("");
}

test("outline targets remain aligned across diagrams and ignore fenced headings", () => {
  const markdown = [
    "# 文档标题", "## 接入", "### 1. 身份校验", "```text", "## 代码里的标题", "```",
    "```mermaid", "flowchart LR", "A --> B", "```", "## 调度", "### 执行结果",
  ].join("\n\n");
  const outline = extractArticleOutline(markdown);
  const html = renderArticle(markdown);
  const ids = [...html.matchAll(/<h[23] id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(outline.map((item) => item.id), ids);
  assert.deepEqual(outline.map((item) => item.text), ["接入", "1. 身份校验", "调度", "执行结果"]);
});

test("omitting related-note entries from the outline does not shift later anchors", () => {
  const markdown = "## 正文\n\n内容\n\n## 相关笔记\n\n[[其他文档]]\n\n## 附录\n\n补充";
  const outline = extractArticleOutline(markdown);
  const html = renderArticle(markdown);
  assert.equal(outline.length, 2);
  assert.match(html, new RegExp(`id="${outline[1].id}"[^>]*>附录</h2>`));
});

test("shared rendering keeps token-based image access and hides private note links", () => {
  const html = renderArticle("## 附件\n\n![架构图](JCG/附件/架构图.png)\n\n[[私有文档|参考说明]]", {
    assetUrl: (path) => `/api/share/test-token/asset?path=${encodeURIComponent(path)}`,
    resolveLinks: false,
  });
  assert.match(html, /\/api\/share\/test-token\/asset\?path=/);
  assert.doesNotMatch(html, /\/api\/obsidian\/asset|data-resolve|\/reading/);
  assert.match(html, /参考说明/);
});

test("the opening title remains in the editable DOM to preserve the source Markdown", () => {
  const html = renderArticle("# 文档标题\n\n## 第一节\n\n正文");
  assert.match(html, /<h1>文档标题<\/h1>/);
});

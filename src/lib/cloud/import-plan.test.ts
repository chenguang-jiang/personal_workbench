import assert from "node:assert/strict";
import { test } from "node:test";
import { IMPORT_INBOX, importFilename, safeImportRelativePath, validateImportPlan } from "./import-plan";

const candidate = { id: "existing", title: "OAuth 认证", folder: "JCG/技术", path: "JCG/技术/OAuth 认证.md" };
const folders = [IMPORT_INBOX, candidate.folder];

test("AI cannot select an unknown directory or traverse outside the vault", () => {
  for (const folder of ["../../etc", "/etc", "JCG/.obsidian", "JCG/不存在"]) {
    assert.equal(validateImportPlan({ folder, confidence: 1 }, folders, [], "文档").folder, IMPORT_INBOX);
  }
  for (const value of ["../a.md", "a/../b.md", "a\\b.md", "/a.md", "a//b.md", "a/\0b.md"]) assert.equal(safeImportRelativePath(value), false);
  assert.equal(safeImportRelativePath("JCG/技术/OAuth 认证.md"), true);
});

test("low confidence falls back to the inbox without overwriting", () => {
  const result = validateImportPlan({ folder: candidate.folder, action: "update", targetId: candidate.id, confidence: 0.6 }, folders, [candidate], candidate.title);
  assert.equal(result.folder, IMPORT_INBOX);
  assert.equal(result.action, "create");
  assert.equal(result.pending, true);
});

test("only a high-confidence exact-title candidate can be updated", () => {
  const raw = { title: candidate.title, folder: candidate.folder, action: "update", targetId: candidate.id, confidence: 0.98 };
  assert.equal(validateImportPlan(raw, folders, [candidate], candidate.title).action, "update");
  assert.equal(validateImportPlan({ ...raw, targetId: "unrelated" }, folders, [candidate], candidate.title).action, "create");
  assert.equal(validateImportPlan(raw, folders, [candidate], "另一篇文章").action, "create");
  assert.equal(validateImportPlan({ ...raw, confidence: 0.8 }, folders, [candidate], candidate.title).action, "create");
});

test("filename creation removes separators and hidden-file prefixes", () => {
  const result = importFilename("../../.env\0/私钥");
  assert.ok(!result.startsWith("."));
  assert.ok(!result.includes("/"));
  assert.ok(!result.includes("\0"));
  assert.ok(result.endsWith(".md"));
});

test("an explicit title remains stable even if AI suggests a different title", () => {
  const result = validateImportPlan({ title: "AI 改写的标题", folder: candidate.folder, confidence: 0.95 }, folders, [], candidate.title);
  assert.equal(result.title, candidate.title);
  assert.ok(Buffer.byteLength(importFilename("知识".repeat(100)), "utf8") <= 203);
});


test("untitled pasted content and links use AI titles even when a heading or page title exists", () => {
  const result = validateImportPlan({ title: "DeepSeek 知识库自动归档流程", folder: candidate.folder, confidence: 0.95 }, folders, [], "网页站点 · 首页", true);
  assert.equal(result.title, "DeepSeek 知识库自动归档流程");
  assert.equal(importFilename(result.title), "DeepSeek 知识库自动归档流程.md");
  assert.equal(validateImportPlan({ title: "   " }, folders, [], "正文第一句", true).title, "正文第一句");
  assert.equal(validateImportPlan(null, folders, [], "正文第一句", true).title, "正文第一句");
});

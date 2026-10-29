import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClassifyJson, safeFolderRelativePath, validateClassifyBatch } from "./plan";
import type { ClassifyCandidate } from "./scan";

const candidate: ClassifyCandidate = {
  id: "reclassify-a1",
  articleId: "a1",
  title: "OAuth 入门",
  path: "JCG/00-Inbox/OAuth 入门.md",
  folder: "JCG/00-Inbox",
  excerpt: "OAuth 2.0 授权码流程……",
};
const folders = ["JCG/00-Inbox", "JCG/技术", "JCG/技术/安全"];

test("a well-formed high-confidence suggestion becomes a move item", () => {
  const items = validateClassifyBatch(
    [{ id: candidate.id, folder: "JCG/技术/安全", confidence: 0.9, reason: "主题是认证安全" }],
    [candidate],
    folders,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].action, "move");
  assert.equal(items[0].targetPath, "JCG/技术/安全/OAuth 入门.md");
  assert.equal(items[0].defaultChecked, true);
  assert.equal(items[0].reason, "主题是认证安全");
});

test("unknown ids are dropped", () => {
  const items = validateClassifyBatch(
    [{ id: "reclassify-nope", folder: "JCG/技术", confidence: 0.99 }],
    [candidate],
    folders,
  );
  assert.equal(items.length, 0);
});

test("folders outside the allowlist or unsafe are dropped", () => {
  for (const folder of ["JCG/不存在", "../../etc", "/etc", "JCG/.obsidian", "a\\b", "", "JCG//技术"]) {
    const items = validateClassifyBatch(
      [{ id: candidate.id, folder, confidence: 0.99 }],
      [candidate],
      folders,
    );
    assert.equal(items.length, 0, `folder ${JSON.stringify(folder)} 应被丢弃`);
  }
  assert.equal(safeFolderRelativePath("JCG/技术/安全"), true);
  assert.equal(safeFolderRelativePath(" JCG/技术"), false);
});

test("low confidence is dropped outright, not downgraded to the inbox", () => {
  const items = validateClassifyBatch(
    [{ id: candidate.id, folder: "JCG/技术", confidence: 0.5, reason: "不确定" }],
    [candidate],
    folders,
  );
  assert.equal(items.length, 0);
  // 0.72 是门槛值本身，达到即接受
  assert.equal(
    validateClassifyBatch([{ id: candidate.id, folder: "JCG/技术", confidence: 0.72 }], [candidate], folders).length,
    1,
  );
});

test("mid-confidence items are kept but not checked by default", () => {
  const items = validateClassifyBatch(
    [{ id: candidate.id, folder: "JCG/技术", confidence: 0.75 }],
    [candidate],
    folders,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].defaultChecked, false);
});

test("a suggestion to stay in the same folder is dropped", () => {
  const items = validateClassifyBatch(
    [{ id: candidate.id, folder: "JCG/00-Inbox", confidence: 0.99 }],
    [candidate],
    folders,
  );
  assert.equal(items.length, 0);
});

test("duplicate ids collapse to one item and reasons are truncated", () => {
  const items = validateClassifyBatch(
    [
      { id: candidate.id, folder: "JCG/技术", confidence: 0.9, reason: "x".repeat(400) },
      { id: candidate.id, folder: "JCG/技术/安全", confidence: 0.95 },
    ],
    [candidate],
    folders,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].reason.length, 250);
});

test("parseClassifyJson accepts arrays and {items} wrappers, rejects garbage", () => {
  assert.deepEqual(parseClassifyJson('[{"id":"a"}]'), [{ id: "a" }]);
  assert.deepEqual(parseClassifyJson('前缀噪音 {"items":[{"id":"a"}]} 后缀'), [{ id: "a" }]);
  assert.equal(parseClassifyJson("完全不是 JSON"), null);
  assert.equal(parseClassifyJson('{"foo":1}'), null);
});

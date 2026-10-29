import assert from "node:assert/strict";
import { test } from "node:test";
import { isIndexPath, selectIndexPaths, upsertIndexEntry } from "./markdown-index";
import { isPublicImportAddress, publicImportUrl, extractImportedPage } from "./link-import";

test("indexes use a nearby existing directory and accept only known AI candidates", () => {
  const existing = ["JCG/index.md", "JCG/AI/索引.md", "JCG/AI/Kiro介绍索引.md"];
  assert.deepEqual(selectIndexPaths("JCG/AI/笔记.md", existing, ["../../secret.md", "JCG/AI/Kiro介绍索引.md"]), ["JCG/AI/Kiro介绍索引.md", "JCG/AI/索引.md"]);
  assert.deepEqual(selectIndexPaths("JCG/新主题/笔记.md", [], null), ["JCG/新主题/索引.md"]);
  assert.equal(isIndexPath("JCG/数据库索引迁移方案.md"), false);
});
test("index writes preserve handwritten content, are idempotent, and update their own link", () => {
  const original = "# 我的索引\n\n手写内容请保留。\n";
  const first = upsertIndexEntry(original, "JCG/AI/笔记.md", "标题");
  assert.ok(first.startsWith(original));
  assert.equal(upsertIndexEntry(first, "JCG/AI/笔记.md", "标题"), first);
  const updated = upsertIndexEntry(first, "JCG/AI/笔记.md", "新标题");
  assert.equal((updated.match(/- \[\[/g) || []).length, 1);
  assert.ok(updated.includes("|新标题]]"));
  assert.equal(upsertIndexEntry("手写 [[JCG/AI/笔记]]", "JCG/AI/笔记.md", "标题"), "手写 [[JCG/AI/笔记]]");
});
test("public link policy rejects private, mapped, credentials and non-http targets", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "::1", "::ffff:7f00:1", "fc00::1", "2001:db8::1"]) assert.equal(isPublicImportAddress(ip), false, ip);
  assert.equal(isPublicImportAddress("8.8.8.8"), true);
  for (const url of ["file:///etc/passwd", "https://user:pass@example.com", "http://example.com:8090"]) assert.throws(() => publicImportUrl(url));
});
test("web extraction keeps the article text without navigation or scripts", () => {
  const page = extractImportedPage('<html><head><title>文章 &amp; 资料</title></head><nav>菜单</nav><article><h1>标题</h1><p>第一段</p><p>第二段</p><script>恶意脚本</script></article></html>');
  assert.equal(page.title, "文章 & 资料");
  assert.ok(page.content.includes("# 标题"));
  assert.ok(!page.content.includes("菜单") && !page.content.includes("恶意脚本"));
});

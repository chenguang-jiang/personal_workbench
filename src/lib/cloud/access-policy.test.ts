import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideCloudAccess } from "./access-policy";

const authed = { isAuthenticated: true };
const anonymous = { isAuthenticated: false };

describe("cloud access policy", () => {
  test("login page and login API are open to anonymous visitors", () => {
    assert.deepEqual(decideCloudAccess("GET", "/login", anonymous), { kind: "allow" });
    assert.deepEqual(decideCloudAccess("POST", "/api/auth/login", anonymous), { kind: "allow" });
  });

  test("anonymous page requests are redirected to login, API requests get 401", () => {
    assert.equal(decideCloudAccess("GET", "/dashboard", anonymous).kind, "redirect-login");
    assert.equal(decideCloudAccess("GET", "/api/search", anonymous).kind, "unauthorized");
    assert.equal(decideCloudAccess("GET", "/api/obsidian/asset", anonymous).kind, "unauthorized");
  });

  test("public share pages and share assets are readable without login", () => {
    assert.deepEqual(decideCloudAccess("GET", "/s/abc123", anonymous), { kind: "allow" });
    assert.deepEqual(decideCloudAccess("GET", "/api/share/abc123/asset", anonymous), { kind: "allow" });
    // 匿名对分享前缀的非安全方法不放行；登录后写 /api/share 也不在任何写白名单
    assert.equal(decideCloudAccess("POST", "/api/share/abc123/asset", anonymous).kind, "unauthorized");
    assert.equal(decideCloudAccess("POST", "/api/share/abc123/asset", authed).kind, "forbidden");
    // /s 前缀不误伤 /settings 等页面
    assert.equal(decideCloudAccess("GET", "/settings", anonymous).kind, "redirect-login");
  });

  test("share toggle is an allowed limited write for a signed-in user", () => {
    assert.deepEqual(decideCloudAccess("POST", "/api/articles/abc/share", authed), { kind: "allow" });
    assert.equal(decideCloudAccess("POST", "/api/articles/abc/share", anonymous).kind, "unauthorized");
  });

  test("writes are blocked by default for a signed-in user", () => {
    for (const [method, pathname] of [
      ["POST", "/api/articles"],
      ["PATCH", "/api/articles/abc/content"],
      ["DELETE", "/api/knowledge/abc"],
      ["POST", "/api/obsidian/ingest"],
      ["POST", "/api/dawn-agent/sessions/x/message"],
      ["POST", "/api/some-future-route"],
    ] as const) {
      assert.equal(decideCloudAccess(method, pathname, authed).kind, "forbidden", `${method} ${pathname}`);
    }
  });

  test("reading progress and favorite toggles are allowed with a restricted scope", () => {
    // 字段级约束（进度-only、只写 favoritedAt）由各路由自行校验
    assert.deepEqual(decideCloudAccess("PATCH", "/api/articles/abc", authed), { kind: "allow" });
    assert.deepEqual(decideCloudAccess("PATCH", "/api/articles/abc/", authed), { kind: "allow" });
    assert.deepEqual(decideCloudAccess("POST", "/api/articles/abc/favorite", authed), { kind: "allow" });
    assert.deepEqual(decideCloudAccess("POST", "/api/articles/new", authed), { kind: "allow" });
    // 删除文章：云端 Vault 是独立挂载卷，阅读器内删除需可用（含 ?vault=1 删源文件）
    assert.deepEqual(decideCloudAccess("DELETE", "/api/articles/abc", authed), { kind: "allow" });
    assert.equal(decideCloudAccess("DELETE", "/api/articles/abc", anonymous).kind, "unauthorized");
  });

  test("AI import conversation and archive are allowed in cloud mode", () => {
    assert.deepEqual(decideCloudAccess("POST", "/api/knowledge/ai-import", authed), { kind: "allow" });
    // 对话导入的图片附件落盘到 vault 导入收件箱，云端同样放行
    assert.deepEqual(decideCloudAccess("POST", "/api/knowledge/ai-import/attach-images", authed), { kind: "allow" });
    assert.equal(decideCloudAccess("POST", "/api/knowledge/ai-import/attach-images", anonymous).kind, "unauthorized");
  });

  test("brainstorm and knowledge-spaces writes are allowed in cloud mode", () => {
    for (const [method, pathname] of [
      ["POST", "/api/brainstorm"],
      ["POST", "/api/brainstorm/abc"],
      ["DELETE", "/api/brainstorm/abc"],
      ["POST", "/api/brainstorm/abc/knowledge-message"],
      ["POST", "/api/brainstorm/abc/citation"],
      ["POST", "/api/knowledge-spaces"],
      ["DELETE", "/api/knowledge-spaces/abc"],
      ["POST", "/api/knowledge/reindex"],
      ["POST", "/api/notes"],
      ["DELETE", "/api/notes/abc"],
      ["POST", "/api/quick-notes"],
      ["DELETE", "/api/quick-notes/abc"],
      ["POST", "/api/quiz/2026-10-23"],
      ["POST", "/api/quiz/wrong"],
      ["POST", "/api/knowledge/organize"],
      ["POST", "/api/knowledge/organize/abc/apply"],
      ["POST", "/api/knowledge/trash"],
      ["DELETE", "/api/knowledge/trash"],
      ["POST", "/api/obsidian/folders"],
      ["DELETE", "/api/obsidian/folders"],
    ] as const) {
      assert.equal(decideCloudAccess(method, pathname, authed).kind, "allow", `${method} ${pathname}`);
    }
  });

  test("read-only POST endpoints on the allowlist stay available", () => {
    for (const pathname of [
      "/api/ai/ask",
      "/api/ai/explain",
      "/api/ai/summarize",
      "/api/ai/translate",
      "/api/resolve",
      "/api/obsidian/sync",
      "/api/auth/logout",
      "/api/knowledge/import",
      "/api/knowledge/edit",
    ]) {
      assert.deepEqual(decideCloudAccess("POST", pathname, authed), { kind: "allow" }, pathname);
    }
  });

  test("allowlist matching is exact, not by prefix", () => {
    assert.equal(decideCloudAccess("POST", "/api/ai/ask/extra", authed).kind, "forbidden");
    assert.equal(decideCloudAccess("POST", "/api/resolvex", authed).kind, "forbidden");
  });

  test("signed-in reads are allowed", () => {
    assert.deepEqual(decideCloudAccess("GET", "/dashboard", authed), { kind: "allow" });
    assert.deepEqual(decideCloudAccess("GET", "/api/search", authed), { kind: "allow" });
    assert.deepEqual(decideCloudAccess("HEAD", "/api/graph", authed), { kind: "allow" });
  });

  test("a trailing slash does not bypass the rules", () => {
    assert.equal(decideCloudAccess("POST", "/api/articles/", authed).kind, "forbidden");
  });
});
